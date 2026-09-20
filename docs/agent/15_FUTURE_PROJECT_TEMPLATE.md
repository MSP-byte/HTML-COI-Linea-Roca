# 15 — FUTURE PROJECT TEMPLATE

Plantilla reutilizable para futuros sistemas HTML + Supabase.

# NOMBRE
## Objetivo
¿Qué problema resuelve?

## Usuarios
Roles y permisos.

## Arquitectura
```text
HTML/CSS/JS
↓
Supabase
↓
PostgreSQL + Storage
```

## Fuente única de verdad
Definir autoridad y caches.

## Entidades principales
Para cada entidad:
- propósito;
- clave;
- campos;
- relaciones;
- fuente.

## Storage
- bucket;
- estructura;
- identidad;
- permisos;
- signed URLs.

## Auth
Roles, sesión, permisos y RLS.

## Reglas funcionales
Reglas de negocio explícitas.

## Módulos
Inicio, listado, ficha, alertas, administración, etc.

## UX
Dashboard operativo, responsive, estados vacíos y acciones reales.

## Testing
Unit/integración, Playwright, CI y manual.

## Git
Main, ramas, PR, aprobación de merge.

## Seguridad
RLS, secretos y operaciones destructivas.

## Release
CI, smoke test y rollback.

## Soporte
Bug triage, Known Issues y auditorías.
