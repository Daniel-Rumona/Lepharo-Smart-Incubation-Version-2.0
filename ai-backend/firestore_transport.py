import os


FIRESTORE_GRPC_HOST = "firestore.googleapis.com"
ENCODED_DEFAULT_DATABASE = "%28default%29"
DEFAULT_DATABASE = "(default)"
ROUTING_PARAMS_HEADER = "x-goog-request-params"
ROUTING_BYPASS_HEADER = "x-lph-firestore-routing-bypass"
RESOURCE_PREFIX_HEADER = "google-cloud-resource-prefix"
REDACTED_METADATA_KEYS = frozenset(
    {"authorization", "x-goog-api-key", "x-goog-iam-authorization-token"}
)
PROXY_ENV_VARIABLES = (
    "http_proxy",
    "https_proxy",
    "grpc_proxy",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "GRPC_PROXY",
)

_metadata_guard_state = {"installed": False, "logged": False, "error": None}


def _flag(name: str, default: str) -> bool:
    return os.getenv(name, default).strip().lower() not in {"0", "false", "no", "off"}


def _append_host(variable: str, host: str) -> None:
    current = os.getenv(variable, "")
    entries = [entry.strip() for entry in current.split(",") if entry.strip()]
    if host not in entries:
        entries.append(host)
    os.environ[variable] = ",".join(entries)


def routing_mode() -> str:
    mode = os.getenv("FIRESTORE_DEFAULT_DATABASE_ROUTING_MODE", "suppress").strip().lower()
    return mode if mode in {"suppress", "plain"} else "suppress"


def normalize_firestore_routing_metadata(metadata):
    """Undo only the encoded default-database token in routing metadata."""
    # google.api_core.gapic_v1.routing_header.to_grpc_metadata returns one
    # `(key, value)` pair, which generated Firestore clients append to their
    # metadata tuple. Preserve that exact shape.
    key, value = metadata
    if key == ROUTING_PARAMS_HEADER and isinstance(value, str):
        value = value.replace(ENCODED_DEFAULT_DATABASE, DEFAULT_DATABASE)
    return key, value


def install_firestore_routing_workaround(routing_header_module=None) -> None:
    """Patch GAPIC routing metadata for the hosted proxy's double-encoding bug.

    The request resource path remains the official `(default)` path. Only the
    auxiliary x-goog-request-params routing header is changed, and only for its
    exact encoded default-database token.
    """
    if routing_header_module is None:
        from google.api_core.gapic_v1 import routing_header as routing_header_module

    current = routing_header_module.to_grpc_metadata
    if getattr(current, "_lph_firestore_default_database_fix", False):
        return

    mode = routing_mode()

    def to_grpc_metadata(*args, **kwargs):
        metadata = current(*args, **kwargs)
        key, value = metadata
        if (
            mode == "suppress"
            and key == ROUTING_PARAMS_HEADER
            and isinstance(value, str)
            and ENCODED_DEFAULT_DATABASE in value
        ):
            # The database resource is still present in the protobuf request.
            # Use an inert custom metadata pair so the generated client's tuple
            # shape stays valid; the channel guard drops the placeholder before
            # it ever reaches the wire.
            return ROUTING_BYPASS_HEADER, "default"
        return normalize_firestore_routing_metadata(metadata)

    to_grpc_metadata._lph_firestore_default_database_fix = True
    to_grpc_metadata._lph_firestore_default_database_mode = mode
    routing_header_module.to_grpc_metadata = to_grpc_metadata


def sanitize_grpc_metadata(metadata, *, mode=None, suppress_resource_prefix=False):
    """Strip every encoded default-database token from outgoing gRPC metadata.

    This runs at the last point before the wire, so it covers routing headers
    built by any client code path, not just the patched helper above. The
    protobuf request is untouched and keeps carrying the real `(default)`
    database resource name.
    """
    mode = mode or routing_mode()
    cleaned = []
    changed = False
    for entry in metadata or ():
        key, value = entry[0], entry[1]
        lowered = key.lower() if isinstance(key, str) else key
        if lowered == ROUTING_BYPASS_HEADER:
            # Inert placeholder from the routing patch: never send it upstream.
            changed = True
            continue
        if lowered == RESOURCE_PREFIX_HEADER and suppress_resource_prefix:
            # Advisory routing hint, and the only other header carrying
            # `(default)`. Drop it when an intermediary re-encodes headers.
            changed = True
            continue
        if isinstance(value, str) and ENCODED_DEFAULT_DATABASE in value:
            changed = True
            if lowered == ROUTING_PARAMS_HEADER and mode == "suppress":
                continue
            value = value.replace(ENCODED_DEFAULT_DATABASE, DEFAULT_DATABASE)
        cleaned.append((key, value))
    return cleaned, changed


def redact_metadata(metadata):
    """Secret-free view of gRPC metadata, for logging."""
    redacted = []
    for entry in metadata or ():
        key, value = entry[0], entry[1]
        lowered = key.lower() if isinstance(key, str) else key
        if isinstance(lowered, str) and (
            lowered in REDACTED_METADATA_KEYS or lowered.endswith("-bin")
        ):
            value = "<redacted>"
        redacted.append([key, value])
    return redacted


def suppress_default_database_resource_prefix(client) -> dict[str, object]:
    """Remove the default-database resource-prefix hint from a Firestore client.

    The database remains authoritative in every protobuf request. This removes
    only the advisory high-level client metadata which some hosted proxies turn
    from ``(default)`` into the invalid literal database id ``%28default%29``.
    Named-database prefixes and all unrelated client metadata are preserved.
    """
    internal_metadata = getattr(client, "_rpc_metadata_internal", None)
    metadata = list(
        internal_metadata
        if internal_metadata is not None
        else (getattr(client, "_rpc_metadata", ()) or ())
    )
    filtered = []
    removed = False
    for entry in metadata:
        key, value = entry[0], entry[1]
        lowered = key.lower() if isinstance(key, str) else key
        is_default_prefix = (
            lowered == RESOURCE_PREFIX_HEADER
            and isinstance(value, str)
            and f"/databases/{DEFAULT_DATABASE}" in value
        )
        if is_default_prefix:
            removed = True
            continue
        filtered.append((key, value))

    # google-cloud-firestore's _rpc_metadata property is backed by this field.
    # Set only the internal list so quota-project metadata added by the property
    # continues to work normally.
    if removed:
        client._rpc_metadata_internal = filtered

    effective = list(getattr(client, "_rpc_metadata", ()) or ())
    return {
        "removedDefaultResourcePrefix": removed,
        "remainingMetadataKeys": [
            entry[0] for entry in effective if entry and isinstance(entry[0], str)
        ],
    }


def _build_metadata_guard(suppress_resource_prefix: bool, log_once: bool):
    import json
    from collections import namedtuple

    import grpc

    class _CallDetails(
        namedtuple(
            "_CallDetails",
            ("method", "timeout", "metadata", "credentials", "wait_for_ready", "compression"),
        ),
        grpc.ClientCallDetails,
    ):
        pass

    class _MetadataGuard(
        grpc.UnaryUnaryClientInterceptor,
        grpc.UnaryStreamClientInterceptor,
        grpc.StreamUnaryClientInterceptor,
        grpc.StreamStreamClientInterceptor,
    ):
        def _sanitize(self, details):
            metadata, changed = sanitize_grpc_metadata(
                details.metadata,
                suppress_resource_prefix=suppress_resource_prefix,
            )
            if log_once and not _metadata_guard_state["logged"]:
                _metadata_guard_state["logged"] = True
                print(
                    "Firestore gRPC metadata on the wire:",
                    json.dumps(
                        {
                            "method": str(details.method),
                            "sanitized": changed,
                            "metadata": redact_metadata(metadata),
                        }
                    ),
                    flush=True,
                )
            if not changed:
                return details
            return _CallDetails(
                details.method,
                details.timeout,
                metadata,
                details.credentials,
                getattr(details, "wait_for_ready", None),
                getattr(details, "compression", None),
            )

        def intercept_unary_unary(self, continuation, client_call_details, request):
            return continuation(self._sanitize(client_call_details), request)

        def intercept_unary_stream(self, continuation, client_call_details, request):
            return continuation(self._sanitize(client_call_details), request)

        def intercept_stream_unary(self, continuation, client_call_details, request_iterator):
            return continuation(self._sanitize(client_call_details), request_iterator)

        def intercept_stream_stream(self, continuation, client_call_details, request_iterator):
            return continuation(self._sanitize(client_call_details), request_iterator)

    return _MetadataGuard()


def install_firestore_channel_metadata_guard(transport_class=None) -> None:
    """Wrap the Firestore gRPC channel so no header carries `%28default%29`.

    Must run before the Firestore client creates its channel.
    """
    if _metadata_guard_state["installed"]:
        return

    try:
        import grpc

        if transport_class is None:
            from google.cloud.firestore_v1.services.firestore.transports import (
                grpc as firestore_grpc_transport,
            )

            transport_class = firestore_grpc_transport.FirestoreGrpcTransport

        original = transport_class.create_channel
        if getattr(original, "_lph_firestore_metadata_guard", False):
            _metadata_guard_state["installed"] = True
            return

        guard = _build_metadata_guard(
            suppress_resource_prefix=_flag("FIRESTORE_SUPPRESS_RESOURCE_PREFIX", "true"),
            log_once=_flag("FIRESTORE_LOG_GRPC_METADATA", "true"),
        )

        def create_channel(*args, **kwargs):
            channel = original(*args, **kwargs)
            try:
                return grpc.intercept_channel(channel, guard)
            except Exception as error:  # a broken guard must not break Firestore
                _metadata_guard_state["error"] = f"{type(error).__name__}: {error}"
                return channel

        create_channel._lph_firestore_metadata_guard = True
        # `original` is already bound to the class, so a staticmethod keeps the
        # call shape identical for `Transport.create_channel(...)` callers.
        transport_class.create_channel = staticmethod(create_channel)
        _metadata_guard_state["installed"] = True
    except Exception as error:  # a broken workaround must not block startup
        _metadata_guard_state["error"] = f"{type(error).__name__}: {error}"


def firestore_routing_diagnostic(routing_header_module=None) -> dict[str, object]:
    """Return a secret-free proof of the effective routing helper."""
    if routing_header_module is None:
        from google.api_core.gapic_v1 import routing_header as routing_header_module

    key, value = routing_header_module.to_grpc_metadata(
        (("database", "projects/diagnostic/databases/(default)"),)
    )
    return {
        "patched": bool(
            getattr(
                routing_header_module.to_grpc_metadata,
                "_lph_firestore_default_database_fix",
                False,
            )
        ),
        "mode": getattr(
            routing_header_module.to_grpc_metadata,
            "_lph_firestore_default_database_mode",
            None,
        ),
        "headerKey": key,
        "encodedDefaultPresent": ENCODED_DEFAULT_DATABASE in value,
        "plainDefaultPresent": DEFAULT_DATABASE in value,
    }


def firestore_transport_diagnostic() -> dict[str, object]:
    """Secret-free proof of the channel guard and the proxy environment."""
    return {
        "metadataGuardInstalled": _metadata_guard_state["installed"],
        "metadataGuardError": _metadata_guard_state["error"],
        "suppressResourcePrefix": _flag("FIRESTORE_SUPPRESS_RESOURCE_PREFIX", "true"),
        "proxyEnv": sorted(
            name for name in PROXY_ENV_VARIABLES if os.getenv(name, "").strip()
        ),
        "noProxy": os.getenv("no_proxy", ""),
        "noGrpcProxy": os.getenv("no_grpc_proxy", ""),
    }


def configure_firestore_grpc_transport() -> None:
    """Keep Firestore gRPC off generic HTTP CONNECT proxies.

    Some hosted-container proxy paths forward Firestore's URL-encoded gRPC
    routing metadata literally, causing Google to reject `%28default%29` as the
    database ID. gRPC officially supports no_grpc_proxy/no_proxy host lists.
    This is deliberately scoped to Firestore and preserves existing entries.
    """
    if _flag("FIRESTORE_NORMALIZE_DEFAULT_DATABASE_ROUTING", "true"):
        install_firestore_routing_workaround()

    if not _flag("FIRESTORE_BYPASS_GRPC_PROXY", "true"):
        return

    # grpcio checks the lowercase names on Linux. Mirror uppercase variants so
    # subprocesses and non-gRPC HTTP libraries see a consistent exclusion too.
    for variable in ("no_grpc_proxy", "NO_GRPC_PROXY", "no_proxy", "NO_PROXY"):
        _append_host(variable, FIRESTORE_GRPC_HOST)
