import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import firestore_transport
from firestore_transport import (
    FIRESTORE_GRPC_HOST,
    configure_firestore_grpc_transport,
    firestore_routing_diagnostic,
    install_firestore_routing_workaround,
    normalize_firestore_routing_metadata,
    redact_metadata,
    sanitize_grpc_metadata,
    suppress_default_database_resource_prefix,
)


def _fake_grpc_module():
    """Minimal stand-in so the channel guard can be tested without grpcio."""
    return SimpleNamespace(
        ClientCallDetails=type("ClientCallDetails", (), {}),
        UnaryUnaryClientInterceptor=type("UnaryUnaryClientInterceptor", (), {}),
        UnaryStreamClientInterceptor=type("UnaryStreamClientInterceptor", (), {}),
        StreamUnaryClientInterceptor=type("StreamUnaryClientInterceptor", (), {}),
        StreamStreamClientInterceptor=type("StreamStreamClientInterceptor", (), {}),
        intercept_channel=lambda channel, interceptor: {
            "channel": channel,
            "interceptor": interceptor,
        },
    )


class FirestoreTransportTests(unittest.TestCase):
    def test_decodes_only_default_database_in_routing_header(self):
        self.assertEqual(
            normalize_firestore_routing_metadata(
                ("x-goog-request-params", "database=projects/demo/databases/%28default%29")
            ),
            ("x-goog-request-params", "database=projects/demo/databases/(default)"),
        )
        self.assertEqual(
            normalize_firestore_routing_metadata(("x-other", "%28default%29")),
            ("x-other", "%28default%29"),
        )

    def test_routing_patch_is_idempotent_and_preserves_other_values(self):
        calls = []

        def original(*args, **kwargs):
            calls.append((args, kwargs))
            return ("x-goog-request-params", "database=p/databases/%28default%29")

        module = SimpleNamespace(to_grpc_metadata=original)
        with patch.dict(
            os.environ,
            {"FIRESTORE_DEFAULT_DATABASE_ROUTING_MODE": "plain"},
            clear=True,
        ):
            install_firestore_routing_workaround(module)
            installed = module.to_grpc_metadata
            install_firestore_routing_workaround(module)
            self.assertIs(module.to_grpc_metadata, installed)
            self.assertEqual(
                installed((("database", "p/databases/(default)"),)),
                ("x-goog-request-params", "database=p/databases/(default)"),
            )
            self.assertEqual(len(calls), 1)
            self.assertEqual(
                firestore_routing_diagnostic(module),
                {
                    "patched": True,
                    "mode": "plain",
                    "headerKey": "x-goog-request-params",
                    "encodedDefaultPresent": False,
                    "plainDefaultPresent": True,
                },
            )

    def test_suppresses_default_database_routing_header_by_default(self):
        def original(*_args, **_kwargs):
            return ("x-goog-request-params", "database=p/databases/%28default%29")

        module = SimpleNamespace(to_grpc_metadata=original)
        with patch.dict(os.environ, {}, clear=True):
            install_firestore_routing_workaround(module)
            self.assertEqual(
                module.to_grpc_metadata((("database", "p/databases/(default)"),)),
                ("x-lph-firestore-routing-bypass", "default"),
            )
            self.assertEqual(
                firestore_routing_diagnostic(module),
                {
                    "patched": True,
                    "mode": "suppress",
                    "headerKey": "x-lph-firestore-routing-bypass",
                    "encodedDefaultPresent": False,
                    "plainDefaultPresent": False,
                },
            )

    def test_channel_metadata_never_carries_the_encoded_default_database(self):
        metadata = [
            ("authorization", "Bearer secret-token"),
            ("google-cloud-resource-prefix", "projects/demo/databases/(default)"),
            ("x-goog-request-params", "database=projects%2Fdemo%2Fdatabases%2F%28default%29"),
            ("x-lph-firestore-routing-bypass", "default"),
            ("x-goog-api-client", "gl-python/3.11"),
        ]
        cleaned, changed = sanitize_grpc_metadata(metadata, mode="suppress")
        self.assertTrue(changed)
        self.assertEqual(
            cleaned,
            [
                ("authorization", "Bearer secret-token"),
                ("google-cloud-resource-prefix", "projects/demo/databases/(default)"),
                ("x-goog-api-client", "gl-python/3.11"),
            ],
        )

    def test_plain_mode_decodes_the_routing_header_instead_of_dropping_it(self):
        cleaned, changed = sanitize_grpc_metadata(
            [("x-goog-request-params", "database=projects/demo/databases/%28default%29")],
            mode="plain",
        )
        self.assertTrue(changed)
        self.assertEqual(
            cleaned,
            [("x-goog-request-params", "database=projects/demo/databases/(default)")],
        )

    def test_resource_prefix_is_only_dropped_when_requested(self):
        metadata = [("google-cloud-resource-prefix", "projects/demo/databases/(default)")]
        self.assertEqual(sanitize_grpc_metadata(metadata), (metadata, False))
        self.assertEqual(
            sanitize_grpc_metadata(metadata, suppress_resource_prefix=True),
            ([], True),
        )

    def test_removes_default_resource_prefix_from_high_level_client(self):
        class FakeClient:
            def __init__(self):
                self._rpc_metadata_internal = [
                    ("google-cloud-resource-prefix", "projects/demo/databases/(default)"),
                    ("x-custom", "preserved"),
                ]

            @property
            def _rpc_metadata(self):
                return self._rpc_metadata_internal + [("x-goog-user-project", "billing")]

        client = FakeClient()
        diagnostic = suppress_default_database_resource_prefix(client)
        self.assertTrue(diagnostic["removedDefaultResourcePrefix"])
        self.assertEqual(
            client._rpc_metadata,
            [("x-custom", "preserved"), ("x-goog-user-project", "billing")],
        )

    def test_preserves_named_database_resource_prefix(self):
        client = SimpleNamespace(
            _rpc_metadata=[
                ("google-cloud-resource-prefix", "projects/demo/databases/tenant-a")
            ]
        )
        diagnostic = suppress_default_database_resource_prefix(client)
        self.assertFalse(diagnostic["removedDefaultResourcePrefix"])
        self.assertEqual(
            client._rpc_metadata,
            [("google-cloud-resource-prefix", "projects/demo/databases/tenant-a")],
        )

    def test_channel_guard_wraps_the_transport_channel_and_rewrites_calls(self):
        fake_grpc = _fake_grpc_module()
        transport = SimpleNamespace(create_channel=lambda *_a, **_kw: "raw-channel")

        with patch.dict(sys.modules, {"grpc": fake_grpc}), patch.dict(
            firestore_transport._metadata_guard_state,
            {"installed": False, "logged": True, "error": None},
        ), patch.dict(os.environ, {}, clear=True):
            firestore_transport.install_firestore_channel_metadata_guard(transport)
            self.assertIsNone(firestore_transport._metadata_guard_state["error"])
            self.assertTrue(firestore_transport._metadata_guard_state["installed"])

            channel = transport.create_channel("firestore.googleapis.com")
            self.assertEqual(channel["channel"], "raw-channel")

            guard = channel["interceptor"]
            details = SimpleNamespace(
                method="/google.firestore.v1.Firestore/BatchGetDocuments",
                timeout=None,
                metadata=[
                    ("google-cloud-resource-prefix", "projects/demo/databases/(default)"),
                    ("x-goog-request-params", "database=projects/demo/databases/%28default%29"),
                ],
                credentials=None,
                wait_for_ready=None,
                compression=None,
            )
            sent = []
            guard.intercept_unary_stream(
                lambda call_details, request: sent.append(list(call_details.metadata)),
                details,
                object(),
            )
            self.assertEqual(sent, [[]])

    def test_metadata_logging_hides_credentials(self):
        self.assertEqual(
            redact_metadata(
                [
                    ("authorization", "Bearer secret-token"),
                    ("x-goog-trace-bin", b"\x00"),
                    ("x-goog-api-client", "gl-python/3.11"),
                ]
            ),
            [
                ["authorization", "<redacted>"],
                ["x-goog-trace-bin", "<redacted>"],
                ["x-goog-api-client", "gl-python/3.11"],
            ],
        )

    def test_adds_firestore_to_grpc_and_http_no_proxy_lists(self):
        with patch.dict(
            os.environ,
            {
                "no_proxy": "localhost,127.0.0.1",
                "FIRESTORE_NORMALIZE_DEFAULT_DATABASE_ROUTING": "false",
            },
            clear=True,
        ):
            configure_firestore_grpc_transport()
            self.assertEqual(
                os.environ["no_proxy"],
                f"localhost,127.0.0.1,{FIRESTORE_GRPC_HOST}",
            )
            self.assertEqual(os.environ["no_grpc_proxy"], FIRESTORE_GRPC_HOST)
            self.assertEqual(os.environ["NO_GRPC_PROXY"], FIRESTORE_GRPC_HOST)

    def test_does_not_duplicate_the_host(self):
        with patch.dict(
            os.environ,
            {
                "no_grpc_proxy": FIRESTORE_GRPC_HOST,
                "FIRESTORE_NORMALIZE_DEFAULT_DATABASE_ROUTING": "false",
            },
            clear=True,
        ):
            configure_firestore_grpc_transport()
            configure_firestore_grpc_transport()
            self.assertEqual(os.environ["no_grpc_proxy"], FIRESTORE_GRPC_HOST)

    def test_can_be_disabled_for_proxy_required_environments(self):
        with patch.dict(
            os.environ,
            {
                "FIRESTORE_BYPASS_GRPC_PROXY": "false",
                "FIRESTORE_NORMALIZE_DEFAULT_DATABASE_ROUTING": "false",
                "no_proxy": "localhost",
            },
            clear=True,
        ):
            configure_firestore_grpc_transport()
            self.assertEqual(os.environ["no_proxy"], "localhost")
            self.assertNotIn("no_grpc_proxy", os.environ)


if __name__ == "__main__":
    unittest.main()
