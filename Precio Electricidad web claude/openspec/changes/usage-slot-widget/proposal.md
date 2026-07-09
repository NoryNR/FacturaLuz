## Why

Los usuarios planifican el uso de electrodomésticos de larga duración (lavadora, horno, lavavajillas, secadora) buscando manualmente el tramo más barato del día. Hoy la aplicación muestra precios hora a hora, pero exige que el usuario haga el cálculo mental de qué bloque consecutivo de N horas tiene el coste agregado mínimo y cuánto le costará en euros usar su aparato durante ese tiempo. Un widget que reciba la duración del uso continuo y la potencia del aparato puede devolver directamente los mejores tramos del día y el coste estimado, eliminando esa fricción y traduciendo el precio €/MWh a un valor accionable en €.

## What Changes

- **usage-slot-input**: Aceptar como entrada del usuario la duración del uso continuo (en horas, valor entero entre 1 y 24) y la potencia del aparato (en vatios, valor positivo).
- **best-consecutive-slots**: Calcular los tres mejores tramos consecutivos de la duración indicada dentro del día actualmente visualizado, ordenados por precio medio ascendente, sin solapamiento entre los tramos propuestos.
- **slot-cost-estimation**: Para cada tramo propuesto, mostrar hora de inicio y fin, precio medio del tramo en €/MWh y coste estimado en € calculado a partir del precio medio, la potencia y la duración.
- **usage-slot-widget-presentation**: Presentar el widget como una sección visible en la página principal, integrado con el estilo existente, que recalcule los tramos cuando cambia la entrada del usuario o cuando se actualizan los precios del día visualizado.
- **slot-input-validation**: Rechazar entradas inválidas (duración mayor que las horas disponibles del día, potencia no positiva, valores no numéricos) con un mensaje claro y sin romper el resto de la interfaz.
- **empty-data-handling**: Cuando no haya datos de precios disponibles para el día visualizado, indicar al usuario que el cálculo no es posible en lugar de mostrar tramos vacíos o erróneos.

## Impact

- Nueva sección visible en la página principal de la aplicación.
- Lógica de cálculo añadida sobre la serie de precios horarios ya existente; no requiere nuevas fuentes de datos ni llamadas adicionales a APIs externas.
- Estilos visuales nuevos coherentes con el tema oscuro y la paleta actual.
- Sin cambios en el contrato de las APIs externas ya consumidas ni en el modo demo.
- Sin nuevas dependencias externas ni herramientas de build.
