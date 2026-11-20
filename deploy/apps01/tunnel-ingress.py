#!/usr/bin/env python3
"""Voegt een hostname toe aan de ingress-configuratie van een Cloudflare-tunnel (of werkt hem bij).

Gebruik: tunnel-ingress.py HUIDIG.json NIEUW.json HOSTNAME SERVICE
HUIDIG.json is het antwoord van GET .../cfd_tunnel/<id>/configurations; NIEUW.json wordt de body voor de PUT.
Bestaande regels en overige instellingen blijven staan; de nieuwe regel komt vóór de catch-all, en er is altijd een
catch-all als laatste regel. Drukt de regels af (stdout) zodat ze vóór de PUT bevestigd kunnen worden.
"""
import json
import sys

CATCH_ALL = {"service": "http_status:404"}


def merge_ingress(response, hostname, service):
    """Geeft de nieuwe configuratie terug met een regel hostname -> service.

    @param response: dict, het API-antwoord met result.config.
    @param hostname: str, de publieke hostname.
    @param service: str, de interne service-URL.
    @returns: dict met de volledige config voor de PUT.
    """
    config = dict((response.get("result") or {}).get("config") or {})
    ingress = [dict(rule) for rule in (config.get("ingress") or [])]
    for rule in ingress:
        if rule.get("hostname") == hostname:
            rule["service"] = service
            break
    else:
        position = len(ingress) - 1 if ingress and "hostname" not in ingress[-1] else len(ingress)
        ingress.insert(position, {"hostname": hostname, "service": service})
    if not ingress or "hostname" in ingress[-1]:
        ingress.append(dict(CATCH_ALL))
    config["ingress"] = ingress
    return config


def main(argv):
    """Leest HUIDIG.json, schrijft NIEUW.json en toont de regels.

    @param argv: list, de opdrachtregel.
    @returns: int, de exitcode.
    """
    current_path, target_path, hostname, service = argv[1:5]
    with open(current_path, encoding="utf-8") as handle:
        config = merge_ingress(json.load(handle), hostname, service)
    with open(target_path, "w", encoding="utf-8") as handle:
        json.dump({"config": config}, handle)
    for rule in config["ingress"]:
        print(f"  {rule.get('hostname', '(overig)')} -> {rule['service']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
