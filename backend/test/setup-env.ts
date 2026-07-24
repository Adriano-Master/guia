// Env mínima para os testes e2e passarem na validação de configuração.
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test?schema=public';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
process.env.APP_BASE_URL ??= 'http://localhost:8080';
// Sem scheduler nos e2e: a recomputação de ranking em background interferiria
// nos dados dos testes (e2e chamam recomputarTodos() explicitamente).
process.env.RANKING_CRON_DISABLED ??= 'true';
