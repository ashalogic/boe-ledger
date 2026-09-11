import json
import os
import sys
import time

import requests


original_get = requests.get


def resilient_get(*args, **kwargs):
    """Retry interrupted Wago/DBC downloads before BonusIdTool sees them."""
    kwargs.setdefault("timeout", (15, 180))
    last_error = None
    for attempt in range(5):
        try:
            return original_get(*args, **kwargs)
        except requests.exceptions.RequestException as error:
            last_error = error
            if attempt == 4:
                raise
            delay = 2**attempt
            print(
                f"Item data download failed; retrying in {delay}s ({attempt + 1}/5)",
                file=sys.stderr,
                flush=True,
            )
            time.sleep(delay)
    raise last_error


requests.get = resilient_get

tool_path = os.environ.get("BONUS_ID_TOOL_PATH", ".bonus-id-tool")
sys.path.insert(0, tool_path)

try:
    from lib.dbc_file import DBC, get_latest_build
    from lib.direct_dbc_algorithm import DirectDBCAlgorithm
except ImportError as error:
    raise SystemExit("BonusIdTool is missing. Clone TradeSkillMaster/BonusIdTool into .bonus-id-tool") from error

algorithm = DirectDBCAlgorithm(DBC(get_latest_build()))

for line in sys.stdin:
    request = json.loads(line)
    modifiers = {entry["type"]: entry["value"] for entry in request.get("modifiers", [])}
    level = algorithm.process_item_info(
        request["itemId"],
        request.get("bonusLists", []),
        player_level=modifiers.get(9, 0),
        content_tuning_id=modifiers.get(28, 0),
    )
    print(json.dumps({"itemLevel": level}), flush=True)
