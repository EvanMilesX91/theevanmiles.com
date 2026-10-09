"""Configure the integrated local app without displaying credentials."""
from pathlib import Path
import re
import secrets

from dotenv import dotenv_values

service = Path(__file__).resolve().parent
site = service.parents[1]
frontend_env = site / '.env.local'
backend_env = service / '.env'


def put(path: Path, name: str, value: str, *, replace: bool = False) -> None:
    content = path.read_text(encoding='utf-8-sig') if path.exists() else ''
    pattern = rf'(?m)^{re.escape(name)}=.*$'
    line = f'{name}={value}'
    if re.search(pattern, content):
        if not replace:
            return
        content = re.sub(pattern, lambda match: line, content)
    else:
        content = content.rstrip() + '\n' + line + '\n'
    path.write_text(content, encoding='utf-8')


front = dotenv_values(frontend_env)
back = dotenv_values(backend_env)
front_token = front.get('WAYPOINT_SERVICE_TOKEN')
back_token = back.get('WAYPOINT_SERVICE_TOKEN')
if front_token and back_token and front_token != back_token:
    raise SystemExit('The website and engine service tokens differ. Match them before starting.')
token = front_token or back_token or secrets.token_hex(32)
put(frontend_env, 'WAYPOINT_SERVICE_TOKEN', token, replace=True)
put(backend_env, 'WAYPOINT_SERVICE_TOKEN', token, replace=True)
if not front.get('WAYPOINT_SESSION_SECRET'):
    put(frontend_env, 'WAYPOINT_SESSION_SECRET', secrets.token_hex(32), replace=True)
put(frontend_env, 'WAYPOINT_BACKEND_URL', 'http://127.0.0.1:8000')
put(backend_env, 'APP_MODE', 'live', replace=True)
put(backend_env, 'RUNTIME_MODE', 'server')
put(backend_env, 'FRONTEND_ORIGIN', 'http://127.0.0.1:3000', replace=True)
put(backend_env, 'TICK_SECONDS', '30', replace=True)
put(backend_env, 'ALPHA_VANTAGE_API_KEY', '')
password = front.get('WAYPOINT_PASSWORD') or front.get('ADMIN_PASSWORD') or ''
if len(password) < 12:
    print('Set WAYPOINT_PASSWORD (at least 12 characters) in the website .env.local before signing in.')
else:
    print('Private sign-in uses WAYPOINT_PASSWORD, or your existing website admin password if unset.')
print('Local configuration saved. Provider keys were preserved and no credentials were printed.')
