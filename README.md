# AuditCheck

Aplicação acadêmica de autoavaliação de segurança da informação. O questionário usa um recorte de 12 critérios da ISO/IEC 27001:2022 e da LGPD para apoiar o diagnóstico e o planejamento de melhorias.

## Executar

Requer Python 3.10 ou superior. No terminal, a partir da pasta do projeto:

```sh
python -m venv .venv
```

No Windows:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe server.py
```

No macOS ou Linux:

```sh
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python server.py
```

Abra [AuditCheck local](http://127.0.0.1:8000). O servidor cria o SQLite em `data/auditcheck.sqlite3`. Para escolher outro local ou porta, use `--database` e `--port`. O servidor escuta apenas no computador local e foi pensado para uso individual.

## Fluxo de demonstração

1. Abra a avaliação fictícia e veja os gráficos por domínio e por nível de resposta.
2. Altere um controle em **Questionário** e registre uma evidência simulada. Para marcar um controle como não aplicável, inclua uma justificativa.
3. Em **Plano PDCA**, atribua responsáveis e prazos e marque as etapas concluídas.
4. Em **Relatório**, baixe o PDF. O servidor inclui gráficos, escopo, metodologia, respostas, evidências e ações corretivas.
5. Crie outra avaliação em **Histórico**. As anteriores permanecem disponíveis após reiniciar o servidor.

## Estrutura

| Arquivo | Responsabilidade |
| --- | --- |
| `server.py` | Servidor HTTP local e API de avaliações e relatórios |
| `assessment.py` | Validação, cálculo e classificação |
| `storage.py` | Persistência no SQLite e controle de revisões |
| `report.py` | PDF paginado com gráficos vetoriais |
| `web/` | Interface, estilos e catálogo de controles |

O protótipo anterior salvava os dados no navegador. Esta versão usa um banco independente e começa com uma avaliação fictícia.

## Testes

Execute `python -m unittest -v` no mesmo ambiente virtual usado pelo servidor. Os testes exercitam a API HTTP, a persistência, o cálculo, a rejeição de atualizações concorrentes e a geração do PDF.

## Referências

- [ISO/IEC 27001:2022](https://www.iso.org/standard/27001)
- [Lei nº 13.709/2018 (LGPD)](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm)
