from io import BytesIO
from xml.sax.saxutils import escape

from reportlab.graphics.shapes import Drawing, Rect, String
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer

from assessment import CATALOG, QUESTIONS, response

NAVY = colors.HexColor("#101d33")
BLUE = colors.HexColor("#2358db")
MUTED = colors.HexColor("#52647b")
TRACK = colors.HexColor("#e1e8f2")


def bars(rows, maximum, suffix=""):
    drawing = Drawing(480, len(rows) * 24 + 6)
    for index, (label, value) in enumerate(rows):
        y = (len(rows) - index - 1) * 24 + 8
        drawing.add(String(0, y, label, fontName="Helvetica", fontSize=10, fillColor=NAVY))
        drawing.add(Rect(155, y - 1, 255, 10, fillColor=TRACK, strokeColor=None))
        if value:
            drawing.add(Rect(155, y - 1, 255 * value / maximum, 10, fillColor=BLUE, strokeColor=None))
        drawing.add(String(456, y, "—" if value is None else f"{value}{suffix}",
                           textAnchor="end", fontName="Helvetica-Bold", fontSize=10, fillColor=NAVY))
    return drawing


def make_report(record):
    data, summary = record["data"], record["summary"]
    org = data["org"]
    stream = BytesIO()
    doc = SimpleDocTemplate(stream, pagesize=A4, leftMargin=50, rightMargin=50,
                            topMargin=65, bottomMargin=52, title="AuditCheck | Relatório de autoavaliação")
    styles = getSampleStyleSheet()
    for style in styles.byName.values():
        style.textColor = NAVY
    styles["Title"].alignment = 0

    def p(value, style="BodyText"):
        return Paragraph(escape(str(value)).replace("\n", "<br/>"), styles[style])

    def frame(canvas, document):
        width, height = A4
        canvas.setFillColor(NAVY)
        canvas.rect(0, height - 44, width, 44, stroke=0, fill=1)
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 13)
        canvas.drawString(50, height - 28, "AuditCheck")
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 9)
        canvas.drawString(50, 30, f"Avaliação {record['id'][:8]}  |  Revisão {record['revision']}")
        canvas.drawRightString(width - 50, 30, f"Página {document.page}")

    total = len(QUESTIONS)
    score = summary["score"]
    provisional = " · provisório" if score is not None and summary["answered"] < total else ""
    score_label = "—" if score is None else f"{score}%"
    story = [
        p("Relatório de autoavaliação", "Title"),
        p(f"{record['updated_at'][:10]} (UTC) · " + ("Demonstração fictícia" if data["demo"] else "Autoavaliação")),
        p(org["name"] or "Organização sem cadastro", "Heading2"),
        p(f"Setor: {org['sector'] or '—'} · Responsável: {org['owner'] or '—'}"),
        p(f"Escopo: {org['scope'] or 'Pendente'}"),
        p(f"{score_label} · {summary['level']}{provisional} · {summary['answered']}/{total} respondidos", "Heading2"),
        p("Maturidade por domínio", "Heading2"),
        bars(zip_domains(summary), 100, "%"),
        p("Distribuição das respostas", "Heading2"),
        bars([(CATALOG["opts"][key] if key else "Pendente", count)
              for key, count in summary["counts"].items()], total),
        p("Metodologia", "Heading2"),
        p("Score = 100 × soma(nível × peso) ÷ soma(4 × peso), arredondado. "
          "Respostas pendentes e não aplicáveis justificadas ficam fora do cálculo. "
          "Níveis entre 0 e 2 geram achados a verificar. Prioridade = peso × (3 − nível). "
          "Alta a partir de 6, média de 3 a 5 e baixa abaixo de 3."),
        p("Instrumento acadêmico para diagnóstico. Referências: ISO/IEC 27001:2022 e Lei 13.709/2018 (LGPD)."),
        p("Respostas e evidências", "Heading1"),
    ]
    for question in QUESTIONS:
        answer = data["answers"].get(str(question["id"]), {})
        value = response(data, question)
        label = CATALOG["opts"][value] if value else "Pendente"
        details = [p(question["title"], "Heading3"),
                   p(f"{question['ref']} · Peso {question['weight']} · {label}"),
                   p(question["prompt"])]
        if value == "na":
            details.append(p("Justificativa: " + answer["reason"]))
        if answer.get("evidence"):
            details.append(p("Evidência simulada: " + answer["evidence"]))
        story.append(KeepTogether(details))
    story.append(p("Achados e plano PDCA", "Heading1"))
    if not summary["findings"]:
        story.append(p("Nenhum achado nas respostas registradas."))
    for item in summary["findings"]:
        action = data["actions"].get(str(item["id"]), {})
        completed = ", ".join(label for i, label in enumerate(CATALOG["stages"]) if action.get(f"stage{i}"))
        details = [
            p(item["title"], "Heading3"),
            p(f"Prioridade {item['severity'].lower()} ({item['priority']}) · Risco: {item['risk']}"),
            p("Ação sugerida · " + item["fix"]),
        ]
        if action.get("measure", "").strip():
            details.append(p("Ação definida · " + action["measure"]))
        details.append(p("Critério de verificação · " + item["check"]))
        if action.get("verification", "").strip():
            details.append(p("Registro da verificação · " + action["verification"]))
        details.extend([
            p("Agir · Padronizar a medida se eficaz ou revisar o plano."),
            p(f"Responsável: {action.get('owner') or 'A definir'} · Prazo: {action.get('due') or 'A definir'}"),
            p("Etapas concluídas: " + (completed or "Nenhuma")), Spacer(1, 5),
        ])
        story.append(KeepTogether(details))
    doc.build(story, onFirstPage=frame, onLaterPages=frame)
    return stream.getvalue()


def zip_domains(summary):
    return list(zip(CATALOG["domains"], summary["domains"]))
