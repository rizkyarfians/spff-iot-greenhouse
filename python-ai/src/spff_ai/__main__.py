import json
from .config import Settings
from .repository import PostgresRepository, json_default


def main():
    # One evaluation per invocation; no scheduler, migration or control activation.
    result = PostgresRepository(Settings.from_env()).run_once()
    print(json.dumps(result, default=json_default, allow_nan=False, indent=2))


if __name__ == "__main__":
    main()
