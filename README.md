## MANUAL DE USUARIO

🔗 Acceso al sistema:

https://msp-byte.github.io/HTML-COI-Linea-Roca/

Versión actualizada con botón “Actualizar datos Supabase” en Ficha OC:

https://msp-byte.github.io/HTML-COI-Linea-Roca/?v=594

## Sistema COI – Línea General Roca
## Gestión Integral de Obras y Servicios

1. Introducción
El Sistema COI Línea Roca es una herramienta de gestión operativa diseñada para la Coordinación de Obras e Ingeniería, que permite visualizar, administrar y realizar el seguimiento integral de obras, servicios y compromisos contractuales asociados a la red ferroviaria.
Se trata de un sistema liviano, desarrollado en HTML, CSS y JavaScript, sin dependencia de servidores externos, lo que garantiza rapidez, autonomía y disponibilidad inmediata.

2. Objetivo del sistema
Brindar a la Jefatura una herramienta centralizada para:

Supervisión operativa en tiempo real
Control de Órdenes de Compra (OC)
Seguimiento de certificaciones
Monitoreo de vencimientos contractuales
Planificación de obras y servicios
Toma de decisiones basada en indicadores visuales


3. Estado del sistema

Versión del repositorio: 60.0.1
Estado del código: candidato RC1 validado localmente en Fase 9
Condición pendiente para producción: aplicar y validar las seis migraciones de
`supabase/migrations` primero en staging, con backup y smoke autenticado por
rol. RC1 no equivale a autorización de producción.


4. Alcance funcional
El sistema integra las siguientes capacidades:
4.1 Gestión operativa

Dashboard general (COI)
Gestión de Obras
Gestión de Servicios
Dashboard por estación

4.2 Administración contractual

Registro y seguimiento de Órdenes de Compra (OC)
Fichas individuales por OC
Control de vencimientos contractuales
Gestión de documentación asociada

4.3 Seguimiento y control

Certificaciones automáticas
Calendario operativo
Indicadores visuales tipo semáforo (estado de situación)
Historial de versiones

4.4 Visualización territorial

Plano interactivo de la Red Línea Roca
Navegación por estaciones
Análisis geográfico de intervenciones

4.5 Herramientas de análisis

Buscador multicriterio
Exportación de datos en formato CSV
Persistencia de información mediante LocalStorage


5. Descripción de módulos
5.1 Dashboard COI
Panel principal que concentra la información crítica del sistema:

Estado de obras y servicios
Alertas operativas
Vencimientos próximos
Indicadores visuales


5.2 Gestión de Obras y Servicios
Permite:

Registrar intervenciones
Clasificar por tipo y ubicación
Asociar Órdenes de Compra
Controlar estado de avance


5.3 Órdenes de Compra (OC)
Módulo central para la gestión contractual:

Alta y edición de OC
Consulta individual mediante fichas
Seguimiento de cumplimiento
Relación con obras/servicios


5.4 Calendario Operativo
Visualiza:

Fechas clave
Vencimientos
Certificaciones programadas

Permite anticipar desvíos y planificar acciones correctivas.

5.5 Certificaciones y vencimientos

Generación automática de certificaciones
Alertas por vencimientos
Control de tiempos contractuales


5.6 Plano interactivo
Herramienta visual para:

Ubicar obras y servicios en la red
Analizar impacto territorial
Navegar por estaciones


5.7 Buscador multicriterio
Permite filtrar información según:

Estación
Tipo de intervención
Estado
Número de OC


6. Tecnologías utilizadas

HTML5
CSS3
JavaScript (ES6)
Supabase (PostgreSQL, Auth, RLS, RPC y Storage)
LocalStorage (preferencias, caché autenticada y respaldo legacy controlado)
Node.js para controles reproducibles
Playwright para pruebas de navegador

7. Consideraciones operativas

Supabase es la fuente de verdad de los datos operativos.
Sin sesión, la aplicación no muestra caché operativa.
Sin conexión, sólo se admite lectura de caché para una sesión autenticada.
Las operaciones financieras requieren las RPC versionadas del repositorio.
Las etapas contractuales, los links documentales y el borrado de OCs también
se confirman mediante RPC transaccionales del servidor.
GitHub Pages publica el frontend estático; no contiene secretos privados.
El cargador CDN usa `@supabase/supabase-js` 2.112.2 fijado y un proveedor de
respaldo para evitar cambios de runtime no revisados.
Recomendado para Chrome o Edge modernos en entorno de escritorio.

7.1 Desarrollo y pruebas

Requisitos: Node.js 22 o superior.

```bash
npm ci
npm test
npm run test:e2e:install
npm run test:e2e
```

La guía de despliegue y recuperación de base está en
`supabase/README.md` y el runbook ejecutable en
`supabase/PREPRODUCCION.md`. La evidencia RC1 y las limitaciones del entorno
están en `docs/auditoria/FASE_9_ESTABILIZACION_PREPRODUCCION.md`.


8. Evolución del sistema (Roadmap)
Próximas funcionalidades previstas:

Repositorio de Unidades de Mantenimiento (UM)
Incorporación de fotografías por UM
Documentación adjunta a cada OC
Exportación a calendario (Outlook / Google Calendar – formato ICS)
Dashboard financiero
Integración con Power BI
Vinculación con Excel Maestro


9. Autor y desarrollo
Responsable del desarrollo:
Mariano Special
Destino del proyecto:
Gerencia de Obras e Ingeniería – Línea General Roca (SOFSA)

10. Conclusión
El Sistema COI Línea Roca constituye una herramienta estratégica para la gestión moderna de obras y servicios, permitiendo consolidar información crítica, mejorar la trazabilidad operativa y facilitar la toma de decisiones a nivel de jefatura.



## Autor



