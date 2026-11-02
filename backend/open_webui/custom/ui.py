"""Public UI configuration only; never put credentials in CUSTOM_UI."""
import json
import logging


def load_custom_ui(raw: str) -> dict:
    try:
        value = json.loads(raw)
        if isinstance(value, dict):
            return value
    except (ValueError, TypeError):
        pass
    logging.getLogger(__name__).warning("CUSTOM_UI must be a JSON object; custom features disabled")
    return {}


def custom_webui_name(upstream: str, raw: str) -> str:
    """Apply the existing public brand configuration to PWA and API identity."""
    brand = load_custom_ui(raw).get("brand")
    if not isinstance(brand, dict) or brand.get("suffix") is not False:
        return upstream
    name = brand.get("name")
    if isinstance(name, str) and name.strip():
        return name.strip()
    return upstream.removesuffix(" (Open WebUI)")
