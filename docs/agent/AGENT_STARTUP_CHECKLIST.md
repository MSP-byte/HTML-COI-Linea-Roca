# AGENT STARTUP CHECKLIST

## 1. Confirmar repositorio
```bash
pwd
git remote -v
```

## 2. Confirmar rama
```bash
git branch --show-current
```

## 3. Confirmar estado
```bash
git status
```
Si hay archivos modificados/untracked no relacionados, detenerse.

## 4. Confirmar último commit
```bash
git log -1 --oneline
```

## 5. Confirmar relación con origin
```bash
git fetch origin
git status -sb
```

## 6. Identificar continuidad
Antes de crear rama nueva verificar si el usuario indicó PR, rama o commit existentes.

## 7. Leer documentación
Leer `CLAUDE.md` y luego los documentos `docs/agent/` del tipo de tarea.

## 8. Antes de editar
Identificar:
- módulo;
- funciones;
- tablas/RPC/Storage;
- tests existentes.

## 9. Detenerse si
- rama incorrecta;
- main sucio cuando debería estar limpio;
- conflicto con otra tarea;
- falta acceso;
- se requiere SQL/migración/DELETE no autorizado.
