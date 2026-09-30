import json
import os
import urllib.error
import urllib.request
from typing import Any, Optional


class GatewayError(RuntimeError):
    """The Lepharo Firebase gateway could not be reached or rejected the request."""

    def __init__(self, message: str, status: Optional[int] = None, code: Optional[str] = None):
        super().__init__(message)
        self.status = status
        self.code = code


class LphGateway:
    """Thin client for the trusted Firebase WhatsApp gateway (functions/src/whatsappGateway.ts).

    Firebase stays the only place that reads and writes Lepharo data. This backend
    decides what the user is asking for and asks the gateway to do it for the phone
    number the router already authenticated.
    """

    def __init__(self, url: Optional[str] = None, secret: Optional[str] = None, timeout: float = 15.0):
        self._url = (url if url is not None else os.getenv("LPH_WHATSAPP_GATEWAY_URL", "")).strip().rstrip("/")
        self._secret = (secret if secret is not None else os.getenv("LPH_WHATSAPP_GATEWAY_SECRET", "")).strip()
        self._timeout = timeout

    @property
    def configured(self) -> bool:
        return bool(self._url and self._secret)

    def call(self, action: str, phone: str, **fields: Any) -> dict[str, Any]:
        if not self.configured:
            raise GatewayError("The Lepharo gateway is not configured.")
        body = json.dumps({"action": action, "phoneNumber": phone, **fields}).encode("utf-8")
        request = urllib.request.Request(
            self._url,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json", "X-WhatsApp-Gateway-Secret": self._secret},
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                payload = json.loads(response.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as error:
            try:
                detail = json.loads(error.read().decode("utf-8") or "{}")
            except ValueError:
                detail = {}
            raise GatewayError(
                f"Gateway rejected {action} ({error.code})", status=error.code, code=str(detail.get("error") or "")
            ) from error
        except (urllib.error.URLError, TimeoutError, ValueError) as error:
            raise GatewayError(f"Gateway unavailable for {action}: {error}") from error
        if not isinstance(payload, dict) or payload.get("ok") is False:
            raise GatewayError(f"Gateway returned an error for {action}", code=str((payload or {}).get("error") or ""))
        return payload

    def resolve_identity(self, phone: str) -> Optional[dict[str, Any]]:
        payload = self.call("resolve_identity", phone)
        identity = payload.get("identity")
        return identity if payload.get("matched") and isinstance(identity, dict) else None
