# 08 — GIT & PR WORKFLOW

## Flujo
main actualizado → rama → cambio → tests → commit → push → PR → Quality Gate → validación manual → autorización → merge → pull main → limpieza.

## Antes
```bash
git status
git branch --show-current
git log -1 --oneline
```

## Crear rama
```bash
git switch main
git pull --ff-only origin main
git switch -c fix/nombre-especifico
```

## Naming
`fix/`, `feat/`, `chore/`, `docs/`.

## Scope
Una rama = una responsabilidad.

## Commit
Mensaje claro y específico.

## Antes de push
```bash
git diff
git status
```

## PR
Debe explicar problema, causa raíz, solución, alcance, tests y datos no tocados.

## CI
Si falla, no mergear. Corregir en la misma rama/PR si es la misma tarea.

## Merge
Claude NO tiene autorización implícita. Solo con aprobación explícita.

## Post-merge
```bash
git switch main
git pull --ff-only origin main
git status
git log -1 --oneline
```

## Prohibiciones
Sin autorización: force push, reset destructivo, rebase ajeno, borrar trabajo, modificar main directo.
