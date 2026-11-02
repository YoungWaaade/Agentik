#!/usr/bin/env python3
"""Pilotage du robot aspirateur Roborock pour `supersept robot` (bibliothèque python-roborock).

Appelé par server/cli.mjs avec le Python du venv ~/.local/share/supersept/robot-venv.
Sortie : texte français simple. Identifiants : ~/.config/supersept/roborock/ (0700, hors dépôt).
"""
import asyncio
import json
import os
import pathlib
import stat
import sys

from roborock import RoborockCommand
from roborock.data import UserData
from roborock.devices.device_manager import UserParams, create_device_manager
from roborock.devices.file_cache import FileCache
from roborock.exceptions import RoborockException
from roborock.web_api import RoborockApiClient

DIR = pathlib.Path(os.environ.get("SUPERSEPT_ROBOT_DIR", "~/.config/supersept/roborock")).expanduser()
SESSION = DIR / "session.json"
CACHE = DIR / "cache.pickle"


def die(msg: str, code: int = 1):
    print(f"Erreur : {msg}", file=sys.stderr)
    sys.exit(code)


def private_dir():
    DIR.mkdir(parents=True, exist_ok=True)
    os.chmod(DIR, 0o700)


def write_private(path: pathlib.Path, text: str):
    private_dir()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(text)
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)


def load_session():
    if not SESSION.exists():
        die("le robot n'est pas encore connecté. Il faut d'abord : supersept robot login --email ADRESSE, "
            "puis supersept robot login --code CODE (code reçu par mail).")
    d = json.loads(SESSION.read_text())
    return d["email"], UserData.from_dict(d["user_data"])


# ---------- connexion ----------
async def login_request(email: str):
    write_private(DIR / "pending-email", email)
    await RoborockApiClient(email).request_code_v4()
    print(f"Un code de connexion vient d'être envoyé à {email}. Envoie-moi ce code pour terminer.")


async def login_code(code: str, email: str | None):
    if not email:
        p = DIR / "pending-email"
        if not p.exists():
            die("aucune demande de code en cours. Lance d'abord : supersept robot login --email ADRESSE")
        email = p.read_text().strip()
    user_data = await RoborockApiClient(email).code_login_v4(code)
    write_private(SESSION, json.dumps({"email": email, "user_data": user_data.as_dict()}, default=vars))
    (DIR / "pending-email").unlink(missing_ok=True)
    print(f"Connexion réussie : le compte {email} est relié.")


# ---------- appareil ----------
class Robot:
    async def __aenter__(self):
        email, user_data = load_session()
        private_dir()
        self.cache = FileCache(CACHE)
        self.dm = await create_device_manager(UserParams(username=email, user_data=user_data), cache=self.cache)
        devices = await self.dm.get_devices()
        vacs = [d for d in devices if d.v1_properties is not None] or list(devices)
        if not vacs:
            die("aucun robot trouvé sur ce compte Roborock.")
        self.dev = vacs[0]
        if self.dev.v1_properties is None:
            die(f"le modèle « {self.dev.name} » n'est pas encore pris en charge.")
        self.p = self.dev.v1_properties
        return self

    async def __aexit__(self, *exc):
        try:
            await self.cache.flush()
            os.chmod(CACHE, 0o600)
        except Exception:
            pass
        await self.dm.close()


def etat(st) -> str:
    return str(st.state_name or "inconnu").replace("_", " ")


async def cmd_status():
    async with Robot() as r:
        await r.p.status.refresh()
        st = r.p.status
        nom = etat(st)
        ligne = f"{r.dev.name} : {nom}, batterie {st.battery}%"
        if st.is_battery_charging:
            ligne += " (en charge)"
        extra = []
        if st.clean_time:
            extra.append(f"ménage en cours depuis {round(st.clean_time / 60)} min")
        if st.square_meter_clean_area:
            extra.append(f"{st.square_meter_clean_area} m² nettoyés")
        if extra:
            ligne += " — " + ", ".join(extra)
        print(ligne)
        if st.error_code and st.error_code_name and str(st.error_code_name).lower() not in ("none", "aucune"):
            print(f"Attention, erreur signalée : {st.error_code_name}")


async def room_list(r: Robot):
    await r.p.rooms.refresh()
    out = []
    for room in r.p.rooms.rooms or []:
        out.append((room.segment_id, room.name or f"Pièce {room.segment_id}"))
    return out


async def cmd_rooms():
    async with Robot() as r:
        rooms = await room_list(r)
        if not rooms:
            print("Aucune pièce enregistrée (le robot n'a pas encore de carte découpée en pièces).")
            return
        print("Pièces :")
        for _, name in rooms:
            print(f"- {name}")


def norm(s: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFD", s.lower())
    return "".join(c for c in s if not unicodedata.combining(c)).strip()


async def cmd_simple(action: str):
    cmd = {"start": RoborockCommand.APP_START, "pause": RoborockCommand.APP_PAUSE,
           "stop": RoborockCommand.APP_STOP, "dock": RoborockCommand.APP_CHARGE}[action]
    ok = {"start": "Ménage complet lancé.", "pause": "Robot mis en pause.",
          "stop": "Robot arrêté.", "dock": "Le robot retourne à sa base."}[action]
    async with Robot() as r:
        await r.p.command.send(cmd)
        print(ok)


async def cmd_clean(names: list[str]):
    async with Robot() as r:
        rooms = await room_list(r)
        if not rooms:
            die("aucune pièce connue sur le robot.")
        ids, noms = [], []
        for wanted in names:
            hits = [(i, n) for i, n in rooms if norm(n) == norm(wanted)] or \
                   [(i, n) for i, n in rooms if norm(wanted) in norm(n)]
            if not hits:
                die(f"pièce « {wanted} » introuvable. Pièces connues : " + ", ".join(n for _, n in rooms))
            if len(hits) > 1:
                die(f"« {wanted} » est ambigu : " + ", ".join(n for _, n in hits))
            ids.append(hits[0][0]); noms.append(hits[0][1])
        await r.p.command.send(RoborockCommand.APP_SEGMENT_CLEAN, [{"segments": ids, "repeat": 1}])
        print("Nettoyage lancé : " + ", ".join(noms) + ".")


def parse(argv):
    flags, pos, i = {}, [], 0
    while i < len(argv):
        a = argv[i]
        if a.startswith("--"):
            k = a[2:]
            if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
                flags.setdefault(k, []).append(argv[i + 1]); i += 1
            else:
                flags.setdefault(k, []).append("true")
        else:
            pos.append(a)
        i += 1
    return flags, pos


AIDE = """supersept robot — piloter l'aspirateur Roborock

  supersept robot status                 état, batterie, en charge / en ménage
  supersept robot start                  lancer le ménage complet
  supersept robot pause
  supersept robot stop
  supersept robot dock                   retour à la base
  supersept robot rooms                  liste des pièces
  supersept robot clean --room NOM [--room NOM2 …]   (ou --room "salon,cuisine")
  supersept robot login --email ADRESSE  envoie un code par mail
  supersept robot login --code CODE      termine la connexion"""


async def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("help", "--help", "-h"):
        print(AIDE); return
    sub = sys.argv[1]
    flags, _ = parse(sys.argv[2:])
    if sub == "login":
        if "code" in flags:
            await login_code(flags["code"][0], flags.get("email", [None])[0])
        elif "email" in flags:
            await login_request(flags["email"][0])
        else:
            die("indique --email ADRESSE (pour recevoir un code) ou --code CODE.")
    elif sub == "status": await cmd_status()
    elif sub == "rooms": await cmd_rooms()
    elif sub in ("start", "pause", "stop", "dock"): await cmd_simple(sub)
    elif sub == "clean":
        names = [n.strip() for v in flags.get("room", []) for n in v.split(",") if n.strip() and n != "true"]
        if not names:
            die("indique la pièce : supersept robot clean --room NOM")
        await cmd_clean(names)
    else:
        print(AIDE); sys.exit(1)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except RoborockException as e:
        die(f"Roborock : {e}")
    except Exception as e:  # noqa: BLE001
        die(f"{type(e).__name__} : {e}")
