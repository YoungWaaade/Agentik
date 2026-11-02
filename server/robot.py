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
from roborock.web_api._base import IotLoginInfo

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
    # Le code est lié au serveur de région ET à l'identifiant d'appareil du client : on mémorise les deux
    # pour que l'étape « code » réutilise exactement la même session que l'étape « envoi ».
    client = RoborockApiClient(email)
    info = await client._get_iot_login_info()
    await client.request_code_v4()
    write_private(DIR / "pending.json", json.dumps({
        "email": email, "device_identifier": client._device_identifier,
        "base_url": info.base_url, "country": info.country, "country_code": info.country_code}))
    print(f"Un code de connexion vient d'être envoyé à {email}. Envoie-moi ce code pour terminer.")


async def login_code(code: str, email: str | None):
    p = DIR / "pending.json"
    if not p.exists():
        die("aucune demande de code en cours. Lance d'abord : supersept robot login --email ADRESSE")
    pend = json.loads(p.read_text())
    email = email or pend["email"]
    client = RoborockApiClient(email, base_url=pend["base_url"])
    client._device_identifier = pend["device_identifier"]
    client._iot_login_info = IotLoginInfo(base_url=pend["base_url"], country=pend["country"],
                                          country_code=pend["country_code"])
    user_data = await client.code_login_v4(code.strip())
    write_private(SESSION, json.dumps({"email": email, "user_data": user_data.as_dict()}, default=vars))
    p.unlink(missing_ok=True)
    print(f"Connexion réussie : le compte {email} est relié.")


# ---------- appareil ----------
class Robot:
    """Deux familles de robots : v1 (anciens modèles) et Q10 (protocole B01, ex. « R2 »)."""

    async def __aenter__(self):
        email, user_data = load_session()
        private_dir()
        self.cache = FileCache(CACHE)
        self.dm = await create_device_manager(UserParams(username=email, user_data=user_data), cache=self.cache)
        devices = await self.dm.get_devices()
        vacs = [d for d in devices if d.v1_properties is not None or d.b01_q10_properties is not None]
        if not vacs:
            die("aucun robot pris en charge sur ce compte Roborock.")
        self.dev = vacs[0]
        self.p = self.dev.v1_properties
        self.q = self.dev.b01_q10_properties
        return self

    async def __aexit__(self, *exc):
        try:
            await self.cache.flush()
            os.chmod(CACHE, 0o600)
        except Exception:
            pass
        await self.dm.close()


ETATS = {"charging": "en charge", "idle": "au repos", "sleeping": "en veille", "paused": "en pause",
         "cleaning": "en train de nettoyer", "docking": "retourne à la base", "returning": "retourne à la base",
         "charge complete": "chargé (à la base)", "error": "en erreur", "mopping": "en train de laver"}


def joli(v) -> str:
    if v is None:
        return "inconnu"
    n = str(getattr(v, "name", v)).replace("_", " ").lower()
    return ETATS.get(n, n)


async def q10_refresh(r: Robot):
    """Le Q10 répond en différé : on demande puis on attend la réponse."""
    ev = asyncio.Event()
    unsub = r.q.status.add_update_listener(ev.set)
    try:
        await r.q.refresh()
        try:
            await asyncio.wait_for(ev.wait(), timeout=10)
        except TimeoutError:
            die("le robot ne répond pas (éteint, hors Wi-Fi ou injoignable pour l'instant).")
        await asyncio.sleep(1)
    finally:
        unsub()


async def cmd_status():
    async with Robot() as r:
        if r.q is not None:
            await q10_refresh(r)
            st = r.q.status
            ligne = f"{r.dev.name} : {joli(st.status)}, batterie {st.battery}%"
            if st.clean_time:
                ligne += f" — ménage en cours depuis {round(st.clean_time / 60)} min"
            if st.clean_area:
                ligne += f", {st.clean_area} m² nettoyés"
            print(ligne)
            if st.fault and joli(st.fault) not in ("none", "no fault", "inconnu", "0"):
                print(f"Attention, défaut signalé : {joli(st.fault)}")
            return
        await r.p.status.refresh()
        st = r.p.status
        nom = str(st.state_name or "inconnu").replace("_", " ")
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
    if r.q is not None:
        m = r.q.map
        ev = asyncio.Event()
        unsub = m.add_update_listener(lambda: ev.set() if m.rooms else None)
        try:
            await m.refresh()
            try:
                await asyncio.wait_for(ev.wait(), timeout=40)
            except TimeoutError:
                pass
        finally:
            unsub()
        return [(x.id, x.name or f"Pièce {x.id}") for x in (m.rooms or [])]
    await r.p.rooms.refresh()
    return [(x.segment_id, x.name or f"Pièce {x.segment_id}") for x in (r.p.rooms.rooms or [])]


async def cmd_rooms():
    async with Robot() as r:
        rooms = await room_list(r)
        if not rooms:
            print("Aucune pièce reçue : le robot n'envoie pas sa carte pour l'instant (il faut peut-être le réveiller ou qu'une carte avec pièces soit enregistrée dans l'appli Roborock). Un ménage complet reste possible avec « start ».")
            return
        print("Pièces :")
        for _, name in rooms:
            print(f"- {name}")


def norm(s: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFD", s.lower())
    return "".join(c for c in s if not unicodedata.combining(c)).strip()


# ---------- réglages de nettoyage (Q10) ----------
# Chaque réglage : (drapeau, DP, attribut d'état, {alias: valeur}, libellés français affichés)
# Valeurs vérifiées sur le R2 (écriture puis relecture) le 2026-11-02.
def reglages():
    from roborock.data.b01_q10.b01_q10_code_mappings import (B01_Q10_DP as D, YXCleanType as T,
                                                              YXFanLevel as F, YXWaterLevel as W)
    return {
        "mode": (D.CLEAN_MODE, "clean_mode", "Mode", {
            "aspi": T.VACUUM, "aspiration": T.VACUUM, "vacuum": T.VACUUM,
            "lavage": T.MOP, "laver": T.MOP, "serpillere": T.MOP, "mop": T.MOP,
            "les-deux": T.VAC_AND_MOP, "aspi+lavage": T.VAC_AND_MOP, "aspiration+lavage": T.VAC_AND_MOP,
            "both": T.VAC_AND_MOP}, {
            T.VACUUM: "aspi (aspiration seule)", T.MOP: "lavage (lavage seul)",
            T.VAC_AND_MOP: "les-deux (aspiration + lavage)"}),
        "puissance": (D.FAN_LEVEL, "fan_level", "Puissance d'aspiration", {
            "silencieux": F.QUIET, "quiet": F.QUIET, "equilibre": F.BALANCED, "balanced": F.BALANCED,
            "turbo": F.TURBO, "max": F.MAX, "max+": F.MAX_PLUS, "max-plus": F.MAX_PLUS, "maxplus": F.MAX_PLUS}, {
            F.QUIET: "silencieux", F.BALANCED: "equilibre", F.TURBO: "turbo", F.MAX: "max",
            F.MAX_PLUS: "max+ (le plus fort)"}),
        "eau": (D.WATER_LEVEL, "water_level", "Débit d'eau", {
            "off": W.OFF, "aucun": W.OFF, "coupe": W.OFF, "faible": W.LOW, "low": W.LOW, "bas": W.LOW,
            "moyen": W.MEDIUM, "medium": W.MEDIUM, "fort": W.HIGH, "eleve": W.HIGH, "high": W.HIGH}, {
            W.OFF: "aucun (eau coupée)", W.LOW: "faible", W.MEDIUM: "moyen", W.HIGH: "fort"}),
        "passages": (D.CLEAN_COUNT, "clean_count", "Nombre de passages", {"1": 1, "2": 2, "3": 3},
                     {1: "1 passage", 2: "2 passages", 3: "3 passages"}),
    }


def code_de(v):
    return v.code if hasattr(v, "code") else v


def lire_option(table, brut: str):
    k = norm(brut).replace(" ", "-")
    if k not in table:
        die(f"valeur « {brut} » inconnue. Choix possibles : " + ", ".join(sorted(set(table))))
    return table[k]


async def appliquer_reglages(r: Robot, flags: dict):
    """Écrit les réglages demandés (--mode, --puissance, --eau, --passages). Ne bouge pas le robot."""
    voulu = {k: flags[k][0] for k in ("mode", "puissance", "eau", "passages") if k in flags}
    if not voulu:
        return []
    if r.q is None:
        die("les réglages de mode/puissance/eau ne sont gérés que pour les robots de type Q10 (comme le R2).")
    table = reglages()
    faits = []
    for k, brut in voulu.items():
        dp, attr, titre, alias, libs = table[k]
        val = lire_option(alias, brut)
        await r.q.command.send(command=dp, params=code_de(val))
        faits.append(f"{titre} : {libs[val]}")
    await asyncio.sleep(1.5)
    return faits


async def cmd_modes():
    async with Robot() as r:
        if r.q is None:
            die("cette liste n'existe que pour les robots de type Q10 (comme le R2).")
        await q10_refresh(r)
        st = r.q.status
        print(f"Réglages du {r.dev.name} (options à passer à start / clean, ou à enregistrer avec « set ») :")
        for k, (dp, attr, titre, alias, libs) in reglages().items():
            cur = getattr(st, attr)
            cur_l = libs.get(cur, libs.get(code_de(cur), joli(cur))) if cur is not None else "inconnu"
            print(f"\n--{k}  — {titre} (actuel : {cur_l})")
            for v, lib in libs.items():
                print(f"   • {lib}")
        print("\nExemple : supersept robot start --mode les-deux --puissance turbo --eau moyen --passages 2")
        print("Ces réglages restent mémorisés par le robot jusqu'au prochain changement.")


async def cmd_set(flags):
    async with Robot() as r:
        faits = await appliquer_reglages(r, flags)
        if not faits:
            die("indique au moins un réglage : --mode, --puissance, --eau ou --passages (voir : supersept robot modes).")
        print("Réglages enregistrés (le robot ne bouge pas) : " + " ; ".join(faits) + ".")


async def cmd_simple(action: str, flags: dict | None = None):
    cmd = {"start": RoborockCommand.APP_START, "pause": RoborockCommand.APP_PAUSE,
           "stop": RoborockCommand.APP_STOP, "dock": RoborockCommand.APP_CHARGE}[action]
    ok = {"start": "Ménage complet lancé.", "pause": "Robot mis en pause.",
          "stop": "Robot arrêté.", "dock": "Le robot retourne à sa base."}[action]
    async with Robot() as r:
        faits = await appliquer_reglages(r, flags or {}) if action == "start" else []
        if r.q is not None:
            v = r.q.vacuum
            await {"start": v.start_clean, "pause": v.pause_clean, "stop": v.stop_clean,
                   "dock": v.return_to_dock}[action]()
        else:
            await r.p.command.send(cmd)
        print(ok + (" Réglages : " + " ; ".join(faits) + "." if faits else ""))


async def cmd_clean(names: list[str], flags: dict | None = None):
    async with Robot() as r:
        faits = await appliquer_reglages(r, flags or {})
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
        if r.q is not None:
            await r.q.vacuum.clean_segments(ids)
        else:
            await r.p.command.send(RoborockCommand.APP_SEGMENT_CLEAN, [{"segments": ids, "repeat": 1}])
        print("Nettoyage lancé : " + ", ".join(noms) + "." + (" Réglages : " + " ; ".join(faits) + "." if faits else ""))


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
  supersept robot modes                  réglages dispo (mode, puissance, eau, passages) + valeurs actuelles
  supersept robot set [--mode …] [--puissance …] [--eau …] [--passages N]   enregistre sans bouger
  (start et clean acceptent aussi --mode aspi|lavage|les-deux --puissance silencieux|equilibre|turbo|max|max+ --eau aucun|faible|moyen|fort --passages 1|2|3)
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
    elif sub == "modes": await cmd_modes()
    elif sub == "set": await cmd_set(flags)
    elif sub in ("start", "pause", "stop", "dock"): await cmd_simple(sub, flags)
    elif sub == "clean":
        names = [n.strip() for v in flags.get("room", []) for n in v.split(",") if n.strip() and n != "true"]
        if not names:
            die("indique la pièce : supersept robot clean --room NOM")
        await cmd_clean(names, flags)
    else:
        print(AIDE); sys.exit(1)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except RoborockException as e:
        die(f"Roborock : {e}")
    except Exception as e:  # noqa: BLE001
        die(f"{type(e).__name__} : {e}")
