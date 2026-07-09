# Verify Report: usage-slot-widget

**Date:** 2026-06-25
**Verdict:** PASS_WARNINGS
**Tests:** N/A (browser-only, no test runner configured)
**Build:** N/A (no build step — static files)

---

## Spec Compliance

### Requirement: Entrada de duración y potencia — COMPLIANT

| Scenario | Status | Evidence |
|---|---|---|
| Usuario introduce duración y potencia válidas | ✅ PASS | `input` listeners en `initSlotWidget` → `renderSlotWidget()` inmediato, sin botón |
| Usuario modifica la potencia tras cálculo previo | ✅ PASS | Ranking usa solo `avg` de precios; potencia afecta únicamente `calcSlotCost` |

Valores por defecto: `slotDuration: 2`, `slotPower: 2000` — coherentes con el diseño.

---

### Requirement: Validación de entradas — COMPLIANT

| Scenario | Status | Evidence |
|---|---|---|
| Duración fuera de rango (< 1 o > 24) | ✅ PASS | `isNaN(dur) \|\| !Number.isInteger(dur) \|\| dur < 1 \|\| dur > 24` → mensaje en español con rango permitido |
| Potencia no positiva o no numérica | ✅ PASS | `isNaN(pow) \|\| pow <= 0` → mensaje "La potencia debe ser un número positivo en vatios." |
| Duración mayor que horas disponibles | ✅ PASS | `dur > availableHours` → mensaje con valores concretos (`${dur}h` / `${availableHours}h`) |
| Entradas no numéricas | ✅ PASS | `Number(rawDuration)` → NaN → rechazado por `isNaN` + `!Number.isInteger` |
| No se muestran tramos mientras entrada inválida | ✅ PASS | `renderSlotWidget` retorna tras el bloque de validación fallida |

---

### Requirement: Cálculo de los tres mejores tramos consecutivos — COMPLIANT

| Scenario | Status | Evidence |
|---|---|---|
| Evaluación de todas las ventanas posibles | ✅ PASS | Bucle `for (let i = 0; i <= prices.length - duration; i++)` en `findBestSlots` |
| Ordenación por precio medio asc, desempate por inicio más temprano | ✅ PASS | `windows.sort((a, b) => a.avg - b.avg \|\| a.start - b.start)` |
| Selección greedy sin solapamiento (hasta 3) | ✅ PASS | `usedHours` Set + `!hours.some(h => usedHours.has(h))` |
| Duración == horas disponibles → 1 tramo | ✅ PASS | Bucle produce solo `i=0` → una ventana; guard `duration > prices.length` cubre duración superior |
| Menos de 3 tramos posibles → devuelve los disponibles | ✅ PASS | `accepted` acumula lo que puede; `renderSlotWidget` añade mensaje informativo si `slots.length < 3` |
| Sin datos → lista vacía | ✅ PASS | `if (!prices.length ...) return []` al inicio de `findBestSlots` |

---

### Requirement: Cálculo del coste estimado — COMPLIANT

Fórmula implementada: `(avgMWh / 1000) * (watts / 1000) * hours`

Verificación manual de escenarios del spec:

| Escenario | Cálculo esperado | Resultado función | Estado |
|---|---|---|---|
| 80 €/MWh · 3500 W · 3 h | (80/1000)×(3500/1000)×3 = **0,84 €** | Correcto | ✅ PASS |
| 120 €/MWh · 2200 W · 5 h | (120/1000)×(2200/1000)×5 = **1,32 €** | Correcto | ✅ PASS |
| Precio medio negativo | Coste negativo propagado sin recorte | Sin `Math.max(0, ...)` | ✅ PASS |

---

### Requirement: Presentación de los tramos propuestos — COMPLIANT

| Scenario | Status | Evidence |
|---|---|---|
| Formato de horas "HH:00 – HH:00" en 24h | ✅ PASS | `fmtSlotRange` con `padStart(2,'0')` |
| Cifras en español (coma decimal) | ✅ PASS | `toLocaleString('es-ES', ...)` en `fmtSlotAvg` y `fmtSlotCost` |
| Coste con 2 decimales y símbolo € | ✅ PASS | `minimumFractionDigits: 2, maximumFractionDigits: 2` + `' €'` |
| Precio con unidad €/MWh | ✅ PASS | `fmtSlotAvg` devuelve valor + `' €/MWh'` |
| Tramo más barato destacado visualmente | ✅ PASS | Primera tarjeta: clase `slot-card-best` + badge "✓ Recomendado" + color verde |
| Lista ordenada ascendentemente | ✅ PASS | Greedy devuelve ventanas en orden de precio medio creciente |

---

### Requirement: Reactividad ante cambios del día visualizado — COMPLIANT

| Scenario | Status | Evidence |
|---|---|---|
| Carga inicial de precios | ✅ PASS | `renderAll()` incluye `renderSlotWidget()` al final del `init()` |
| Cambio de día (hoy/mañana) | ✅ PASS | `initTabs` → handler de tab llama `renderSlotWidget()` |
| Comentario de sincronización | ✅ PASS | `// NOTE: renderSlotWidget must accompany all price series updates to stay in sync` |

---

### Requirement: Comportamiento ante ausencia de datos — COMPLIANT

| Scenario | Status | Evidence |
|---|---|---|
| Día sin datos de precios | ✅ PASS | `if (!prices.length)` → "No hay datos de precios disponibles para este día." |
| Datos parciales del día | ✅ PASS | `prices.length` como `availableHours`; ventanas solo cubren índices con dato real |

---

## Convenciones del proyecto

| Regla | Estado |
|---|---|
| Sin `var` — solo `const`/`let` | ✅ PASS |
| Arrow functions para callbacks | ✅ PASS |
| Template literals para interpolación | ✅ PASS |
| Texto UI en español (es-ES) | ✅ PASS |
| Sin librerías externas / imports | ✅ PASS |
| Estado en objeto `state` global | ✅ PASS |
| Funciones puras para validación, búsqueda y coste | ✅ PASS |

---

## Warnings (no bloqueantes)

### W1 — `state.slotError` declarado pero no leído

`state.slotError: ''` inicializado en el objeto `state` (task 3.1 cumplida), pero `renderSlotWidget` nunca lee ni escribe esta propiedad — el mensaje de error se deriva siempre dinámicamente desde `validateSlotInputs`. El comportamiento funcional es correcto, pero la propiedad es estado muerto.

### W2 — Tasks 11.1 y 11.2 pendientes de verificación manual en navegador

Las tareas de validación manual en browser no están marcadas como completadas en `tasks.md`. Requieren comprobación humana (reactiva, visual, cambio de fecha real).

---

## Build / Tests

- **Build command:** No configurado — app de archivos estáticos sin paso de compilación.
- **Test command:** No configurado — app browser-only sin test runner.
- **Coverage:** N/A.

---

## Resumen

| Requisito | Resultado |
|---|---|
| Entrada de duración y potencia | ✅ COMPLIANT |
| Validación de entradas | ✅ COMPLIANT |
| Cálculo de los tres mejores tramos | ✅ COMPLIANT |
| Cálculo del coste estimado | ✅ COMPLIANT |
| Presentación de tramos | ✅ COMPLIANT |
| Reactividad ante cambios de día | ✅ COMPLIANT |
| Comportamiento ante ausencia de datos | ✅ COMPLIANT |

**Críticos:** 0 | **Warnings:** 2 (W1 estado muerto, W2 verificación manual pendiente)
