# Monetização

**Não existe.** Nenhum pagamento, assinatura, comissão, cobrança, plano pago ou integração financeira (R7).

- `feature_flags.monetization_enabled = 0` (seed). Nenhum código a lê para habilitar cobrança.
- Não há tabelas, rotas, bibliotecas ou chaves de pagamento. Qualquer caminho `/api/billing*` retorna 404 (teste `billing.test.ts`).
- A UI mostra “Cobrança: desligada — não existem pagamentos nesta plataforma”.
- `referrals` existe só como estrutura de dados, sem recompensa financeira.

Qualquer mudança neste documento exige decisão expressa do dono do projeto.
