# Design: usage-slot-widget

## Context

La aplicación visualiza precios horarios de la electricidad para un día seleccionado. Hoy el usuario ve la curva de precios y debe deducir mentalmente cuándo conviene encender un electrodoméstico. El widget "Contador de Tramos" introduce una capacidad nueva: dado un consumo continuo (duración en horas, potencia en vatios), proponer los tres mejores momentos del día para realizarlo.

El widget es un consumidor más de la serie de precios horarios que la aplicación ya mantiene en memoria para el día visualizado. No introduce nuevas fuentes de datos, no persiste estado entre sesiones y no requiere comunicación con el exterior: toda su lógica opera sobre lo que ya está cargado. Su ciclo de vida está acoplado al del día visualizado y a dos entradas del usuario que viven exclusivamente dentro del widget.

## Goals / Non-Goals

**Goals:**
- Encapsular toda la lógica del widget en una unidad cohesiva con cuatro responsabilidades claras: capturar entradas, validar, calcular tramos y presentarlos.
- Mantener una única fuente de verdad para los parámetros del usuario (duración y potencia) que conviva con el estado global de la aplicación sin contaminarlo.
- Reaccionar de forma automática a tres disparadores: cambio de duración, cambio de potencia, cambio de precios del día visualizado.
- Aislar el algoritmo de búsqueda de tramos de la capa de presentación, de manera que sea probable manualmente con cualquier serie de precios y verificable contra los escenarios del spec.
- Reutilizar el sistema visual existente (paleta, tipografía, variables de tema, animaciones) para que el widget se perciba como parte natural de la aplicación.

**Non-Goals:**
- No se proponen tramos que crucen la frontera entre días distintos.
- No se incorpora histórico, favoritos ni comparación entre días.
- No se modifica la curva de precios ni los indicadores ya presentes; el widget se añade como sección independiente.
- No se introduce ningún sistema de gestión de estado nuevo; se mantiene el patrón existente de objeto global mutable más renderizado imperativo.
- No se cachean resultados entre cambios de entrada; el coste del algoritmo es trivial frente a la frecuencia de interacción.

## Decisions

### Composición lógica del widget

El widget se descompone en cinco responsabilidades, todas internas a la misma unidad funcional:

1. **Estado del widget.** Tres valores: duración solicitada en horas, potencia solicitada en vatios y mensaje de error activo (cadena vacía cuando no hay error). Estos valores son independientes del estado global de precios pero coexisten con él dentro del mismo espacio de estado de la aplicación, siguiendo el patrón ya establecido de un único objeto mutable accesible desde cualquier función.

2. **Captura de entradas.** Dos controles numéricos visibles permanentemente. Cada uno emite un evento de cambio que dispara el ciclo de recálculo. No existe botón de confirmación: el cálculo es reactivo.

3. **Validación.** Una capa que recibe los valores en bruto procedentes de los controles y devuelve dos cosas: un veredicto (válido o no válido) y, si no es válido, el mensaje a mostrar al usuario. Las reglas son las definidas en el spec: duración entera entre 1 y 24, potencia numérica positiva, duración no superior al número de horas con precio disponible para el día visualizado. La validación se ejecuta antes que el cálculo y, si falla, el cálculo se omite y el área de resultados se sustituye por el mensaje de error.

4. **Búsqueda de tramos.** El núcleo algorítmico. Recibe la serie de precios horarios del día visualizado y la duración solicitada; devuelve hasta tres ventanas de horas consecutivas sin solapamiento, ordenadas de menor a mayor precio medio. Es una función pura: no consulta estado, no produce efectos, su salida depende sólo de sus entradas.

5. **Presentación.** Toma las ventanas devueltas por la búsqueda más la potencia solicitada, calcula el coste estimado de cada una, formatea las cifras según la convención española y produce la lista visible. Destaca la primera ventana como la opción recomendada.

### Flujo de datos

```
Entrada de usuario (duración, potencia)
        │
        ▼
   Validación ──── falla ────▶ Mensaje de error en zona de resultados
        │
       ok
        ▼
Serie de precios del día visualizado
        │
        ▼
   Búsqueda de tramos ──▶ Lista de ventanas (inicio, fin, precio medio)
        │
        ▼
   Cálculo de coste por ventana
        │
        ▼
   Formato y renderizado
```

El disparador del flujo es uno de tres eventos:
- Cambio en el control de duración.
- Cambio en el control de potencia.
- Cambio en la serie de precios cargada (carga inicial, navegación de fecha, refresco).

Cualquiera de los tres recorre el flujo completo de arriba abajo. No hay rutas parciales: el widget no intenta optimizar saltándose pasos. El coste computacional lo permite (ver "Algoritmo de búsqueda" más abajo).

### Integración con el estado global y el ciclo de renderizado existentes

La aplicación mantiene un único objeto de estado mutable y un conjunto de funciones de renderizado que leen ese objeto y actualizan el DOM. El widget se suma a ese patrón sin alterarlo:

- Las tres variables del widget (duración, potencia, error) se añaden como propiedades nuevas del objeto de estado global. Esto las hace inspeccionables desde cualquier punto y consistentes con cómo viven el resto de variables de la aplicación.
- Una función de renderizado dedicada al widget se invoca desde el mismo punto donde ya se invocan las funciones de renderizado existentes cuando cambia la serie de precios. De este modo, el tercer disparador (cambio de precios) se gestiona sin lógica nueva de suscripción: simplemente forma parte del barrido de renderizado que ya existe.
- Los cambios en los controles del propio widget llaman directamente a la función de renderizado del widget, sin tocar otras partes del renderizado global. Esto evita repintar la curva de precios cada vez que el usuario teclea un dígito.

### Algoritmo de búsqueda

Sea `n` el número de horas con precio disponible (a lo sumo 24) y `d` la duración solicitada en horas. El procedimiento es:

1. Construir las `n − d + 1` ventanas posibles de tamaño `d`, cada una caracterizada por su hora de inicio, su hora de fin y el precio medio de las horas que cubre. Si `d > n`, no hay ventanas posibles y la validación ya habrá bloqueado el flujo. Si `d = n`, hay exactamente una ventana y el resultado es esa única ventana.
2. Ordenar las ventanas por precio medio ascendente. En caso de empate, la hora de inicio más temprana queda primero.
3. Seleccionar de forma codiciosa hasta tres ventanas: recorrer la lista ordenada y aceptar cada ventana cuyo rango horario no se solape con ninguna ya aceptada. Detener al alcanzar tres aceptaciones o agotar la lista.
4. Devolver las ventanas aceptadas en el orden en que fueron seleccionadas (que coincide con orden ascendente de precio medio).

La complejidad es despreciable: con `n ≤ 24` el coste es del orden de las decenas de operaciones. No se requiere memoización ni cálculo incremental al cambiar la potencia, porque la potencia no interviene en la búsqueda — sólo en el coste de presentación.

Detalle relevante: el ranking depende sólo del precio medio del tramo. Por tanto, cambiar la potencia o el coste por kilovatio hora no reordena los tramos; sólo recalcula la cifra de euros mostrada. Esto justifica que el escenario "modificar potencia tras un cálculo previo" del spec mantenga las mismas horas de inicio y fin.

### Cálculo del coste estimado

El cálculo es directo y se aplica ventana a ventana en la fase de presentación:

$$
\text{coste en euros} = \frac{\text{precio medio en €/MWh}}{1000} \times \frac{\text{potencia en vatios}}{1000} \times \text{duración en horas}
$$

El resultado se muestra con dos decimales y separador decimal coma. Los valores negativos (excedente renovable) se muestran tal cual, sin recortar a cero ni invertir el signo, para que el usuario perciba el ahorro.

### Reglas de presentación

- Cada tramo se renderiza como una tarjeta o fila independiente que muestra, en este orden de lectura: franja horaria en formato `HH:00 – HH:00`, precio medio en €/MWh, coste estimado en €.
- La primera tarjeta de la lista (el tramo más barato) recibe un tratamiento visual diferenciado — bien por color de acento, bien por mayor peso tipográfico, bien por una etiqueta textual que indique su carácter recomendado. La decisión concreta se toma en la fase de aplicación reutilizando las variables de color ya definidas en el sistema de estilos.
- La zona de resultados es la misma que la zona de mensajes de error: en cualquier momento o se ven tramos, o se ve un mensaje. Nunca ambas cosas. Esto evita interfaces ambiguas en las que el usuario duda si los tramos visibles corresponden a las entradas actuales.

### Valores por defecto

El widget arranca con valores por defecto válidos para los dos controles, de modo que en cuanto los precios del día estén cargados se muestren tramos sin que el usuario tenga que escribir nada. Valores razonables del dominio: una duración de 2 ó 3 horas y una potencia entorno a 2000 vatios cubren los electrodomésticos más representados (lavadora, lavavajillas, horno mediano). La elección concreta se confirma en la fase de aplicación.

### Posicionamiento en la interfaz

El widget se inserta como una sección nueva en el flujo vertical de la página, situada después de los indicadores resumen del día y antes (o después, según pruebas visuales) del gráfico horario. La intención es que el usuario lo descubra al recorrer la página de arriba abajo sin tener que buscar. Se respetan los márgenes, fondos y bordes redondeados ya definidos para las demás secciones, manteniendo coherencia visual sin esfuerzo de diseño nuevo.

## Risks / Trade-offs

- **Acoplamiento al objeto de estado global.** Añadir variables del widget al estado compartido sigue la convención del proyecto pero significa que un error en otra parte del código podría sobrescribir los valores del widget. Mitigación: nombrar las propiedades con un prefijo claro que identifique su pertenencia al widget.
- **Disparador implícito por barrido de renderizado.** Se aprovecha el barrido existente para reaccionar a cambios de precios. Si en el futuro alguien introduce una ruta alternativa de actualización de precios que no pase por ese barrido, el widget quedará desincronizado. Mitigación: documentar en el código que la función de renderizado del widget debe acompañar siempre a las actualizaciones de la serie de precios.
- **Sin debounce en los controles.** La validación y el recálculo se ejecutan en cada pulsación de tecla. Es asumible por el coste despreciable del algoritmo, pero puede producir parpadeo de mensajes de error mientras el usuario escribe un valor multidígito (por ejemplo, al pasar de "1" a "12"). Si en la práctica resulta molesto, se puede introducir un retardo corto sin alterar el resto del diseño.
- **Sin soporte para tramos que crucen días.** Es una decisión consciente para no complicar el modelo. Implica que un consumo de larga duración en horas nocturnas no se evaluará óptimamente cerca de medianoche. Aceptable para el caso de uso típico (electrodomésticos de 1–5 horas).
- **Sensibilidad a series incompletas.** Cuando solo hay datos parciales del día, las ventanas se construyen sólo sobre horas con precio. Esto puede sorprender al usuario que vea menos tramos candidatos de los esperados. Se mitiga con el mensaje específico definido en el spec para duraciones que superan las horas disponibles.
