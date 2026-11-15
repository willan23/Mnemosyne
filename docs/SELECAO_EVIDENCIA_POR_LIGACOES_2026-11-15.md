# Seleção de evidência por ligações — 15 de novembro de 2026

Esta é uma política de **avaliação**, sem importação pela aplicação. Procura recuperar fontes de uma pergunta com vários passos sem confundir pessoas que partilham o primeiro nome. A alternativa anterior cortava documentos individualmente pelo score e podia perder parte da evidência. Foram separados dois efeitos: admitir a pergunta quando existe suporte acima do limiar, e selecionar fontes ligadas às pistas da pergunta. O limiar 0,7 foi conservado da experiência anterior; não houve nova procura de limiar.

O método recebe até 16 candidatos já autorizados, a ordem e scores previamente calculados e até 64 pares do mesmo espaço. Extrai pistas capitalizadas, incluindo sequências de até quatro palavras, com limites de 64 chaves/128 caracteres. Pistas demasiado comuns não ancoram a seleção. Um nome composto não liga automaticamente outro nome com o mesmo primeiro termo. Ligações densas exigem marcador de modelo igual e cosseno pelo menos 0,82, conservado da política anterior; não se leem vetores neste percurso. A procura limita-se a dois passos. Estas pistas não demonstram identidade de pessoas ou verdade dos factos.

O grafo só restringe o conjunto quando encontra uma ligação lexical entre documentos e suporte individual ou de um par dentro desse conjunto. Caso contrário, conserva a ordem semântica anterior, sem fabricar proveniência de ligação. Uma pontuação emprestada de uma fonte exterior não basta para justificar esse corte. O resultado contém IDs, tipo de pista, semente e profundidade; não contém texto ou pistas em bruto. A elegibilidade real é obrigatória antes da leitura de texto e é verificada novamente antes de devolver IDs. Documentos bloqueados, apagados ou de âmbito ambíguo fazem o percurso falhar fechado.

## Desenvolvimento e resultados observados

Foram reutilizados os scores dos mesmos modelos fixados da avaliação de contexto de outubro, conferidos contra a prova anterior. As 176 perguntas de calibração/validação, 76 de desenvolvimento e 64 do antigo holdout já tinham sido observadas. Foram usadas como desenvolvimento desta política; o nome histórico fresh nos ficheiros não significa teste cego novo. Não houve nova inferência, download, leitura de secrets ou chamada paga. Não se apresenta este replay como benchmark de modelos/runtime atuais ou prova de generalização.

| Método no conjunto já observado de 64 perguntas | Recall positivo | Evidência completa | Abstenção correta |
| --- | ---: | ---: | ---: |
| Classificação v2, corte por documento | 0.82813 | 0.625 | 22/24 |
| Admissão por pergunta, mesma ordem | 0.89687 | 0.675 | 22/24 |
| Grafo v4, com fallback conservador | 0.96875 | 0.875 | 22/24 |

Os oito casos multi-hop desse conjunto e os quatro de desenvolvimento passaram a recuperar todas as fontes relevantes. No desenvolvimento de 76 perguntas, a admissão por pergunta já leva o recall de 0,88235 a 0.96324; o grafo v4 conserva esse agregado. Não se atribui todo o ganho à distinção de nomes. No conjunto de 64 perguntas, o ganho adicional do grafo concentra-se nos casos multi-hop com nomes ambíguos.

**A alternativa não cumpre a aceitação de qualidade e não foi integrada.** A auditoria voltou a aplicar os nove critérios anteriores, sem os reduzir: falham cinco. O recall da validação antiga fica em 0.88542, abaixo da referência histórica, há cobertura insuficiente por idioma nesse split e regressão single-hop no desenvolvimento. No conjunto de 64, a evidência completa fica em 87,5% e a abstenção em 22/24, abaixo dos 90%/95% exigidos. As perguntas sobre informação atual ainda misturam uma fonte antiga; há uma fonte inadequada num caso de injeção. Um novo conjunto ainda não inspecionado, nova inferência fixada e validação do fluxo real continuam necessários antes de qualquer integração.

As versões intermédias foram conservadas. A v1 recuperou os casos multi-hop, mas a restrição lexical perdeu traduções e fontes noutros cenários. A v2 acrescentou ligações densas limitadas. A v3 conservou a ordem semântica perante componentes fracos. A v4 exige uma ligação útil entre documentos antes de restringir resultados e verifica de onde vem o suporte do componente. Estes ajustes usaram resultados de desenvolvimento conhecidos; não alteraram rótulos ou limiares para declarar um teste independente aprovado.

## Verificação, risco e rollout

Passaram **43 testes Node**, incluindo 17 da nova política, e 23 contratos de CI/distribuição. Lint completo: zero erros/21 avisos anteriores. Os testes novos cobrem nomes ambíguos, limite de dois passos, proveniência, semelhança entre espaços, scores/IDs forjados, texto inacessível que nunca é lido, revogação durante preparação, entradas imutáveis e instruções de documentos que permanecem dados inertes. O workflow passa a incluir os testes da política. Nenhum modelo generativo ou execução de ferramentas foi testado por este replay.

O risco residual inclui colisões lexicais, nomes compostos que não identificam pessoas, aliases traduzidos, suporte de pares com relevância sem prova factual, modelo que aceita um tópico sem o atributo pedido e distinção insuficiente de informação antiga. O método exige o filtro real de permissões do chamador; não o substitui. Scores são relevância, não probabilidade de verdade. A biblioteca de avaliação não altera permissões ou a política cloud.

Não há alteração do runtime da aplicação, schemas, Rules, índices, TTL, dados persistidos, modelos padrão ou artefactos web/nativos. Não há migração. Rollback: retirar o módulo/testes e a declaração adicional em CI; nenhum consumidor do produto depende deles. Os 2.432 testes frontend/251 ficheiros, build/identidade, ensaios browser, backend/regras/auditorias e artefactos anteriores são conservados por hashes, sem nova execução. Os instaladores continuam desatualizados. As fases 0–6, SDK/aplicação completa em grande volume, qualidade representativa e rollout permanecem abertos; 49 gates falsos, PR em rascunho, sem merge/deploy. Prova: evidence-graph-local-validation-20261115.json.
