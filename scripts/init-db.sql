-- Local development only. Production credentials come from a secret manager.
CREATE ROLE meridian_app LOGIN PASSWORD 'local-app-only' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE meridian_auditor LOGIN PASSWORD 'local-audit-only' NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE meridian TO meridian_app;
GRANT CONNECT ON DATABASE meridian TO meridian_auditor;
GRANT USAGE ON SCHEMA public TO meridian_app;
GRANT USAGE ON SCHEMA public TO meridian_auditor;
