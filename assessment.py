import json
from datetime import date
from pathlib import Path

CATALOG_PATH = Path(__file__).parent / "web" / "catalog.json"
CATALOG = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
QUESTIONS = CATALOG["catalog"]
IDS = {str(question["id"]) for question in QUESTIONS}
LEVELS = ("Inicial", "Em desenvolvimento", "Definido", "Gerenciado", "Otimizado")


def object_fields(value, allowed):
    if not isinstance(value, dict) or value.keys() - allowed:
        raise ValueError("Campos inválidos.")
    return value


def validate(data):
    object_fields(data, {"demo", "org", "answers", "actions"})
    if type(data.get("demo")) is not bool:
        raise ValueError("Tipo de avaliação inválido.")
    validate_organization(data.get("org"))
    for answer in object_fields(data.get("answers"), IDS).values():
        object_fields(answer, {"value", "reason", "evidence"})
        value = answer.get("value", "")
        if not isinstance(value, str) or value not in CATALOG["opts"]:
            raise ValueError("Opção de resposta inválida.")
        validate_text(answer.get("reason", ""), 500)
        validate_text(answer.get("evidence", ""), 500)
    stages = {f"stage{index}" for index in range(4)}
    for action in object_fields(data.get("actions"), IDS).values():
        object_fields(action, stages | {"owner", "due", "measure", "verification"})
        validate_text(action.get("owner", ""), 120)
        validate_text(action.get("measure", ""), 500)
        validate_text(action.get("verification", ""), 500)
        due = action.get("due", "")
        validate_text(due, 10)
        if due:
            if date.fromisoformat(due).isoformat() != due:
                raise ValueError("Prazo inválido.")
        if any(type(action[key]) is not bool for key in stages & action.keys()):
            raise ValueError("Etapa PDCA inválida.")
    return data


def validate_organization(organization):
    limits = {"name": 150, "sector": 100, "owner": 120, "scope": 1800}
    object_fields(organization, limits.keys())
    for name, limit in limits.items():
        validate_text(organization.get(name), limit)
    return organization


def validate_text(value, limit):
    if not isinstance(value, str) or len(value) > limit:
        raise ValueError("Texto inválido ou acima do limite.")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError as error:
        raise ValueError("Texto contém caracteres inválidos.") from error


def response(data, question):
    answer = data["answers"].get(str(question["id"]), {})
    value = answer.get("value", "")
    if value == "na" and not answer.get("reason", "").strip():
        return ""
    return value


def summarize(data):
    counts = dict.fromkeys(("0", "1", "2", "3", "4", "na", ""), 0)
    numerators = [0] * len(CATALOG["domains"])
    denominators = numerators.copy()
    findings = []
    for question in QUESTIONS:
        value = response(data, question)
        counts[value] += 1
        if value in ("", "na"):
            continue
        weight, domain, level = question["weight"], question["domain"], int(value)
        numerators[domain] += weight * level
        denominators[domain] += weight * 4
        if level < 3:
            priority = weight * (3 - level)
            findings.append({**question, "priority": priority,
                             "severity": "Alta" if priority >= 6 else "Média" if priority >= 3 else "Baixa"})

    def percent(points, maximum):
        return (200 * points + maximum) // (2 * maximum) if maximum else None

    score = percent(sum(numerators), sum(denominators))
    return {
        "score": score,
        "level": "Sem pontuação" if score is None else LEVELS[min(score // 20, 4)],
        "domains": [percent(points, maximum) for points, maximum in zip(numerators, denominators)],
        "answered": len(QUESTIONS) - counts[""],
        "counts": counts,
        "findings": sorted(findings, key=lambda item: (-item["priority"], item["id"])),
    }
