# Tasks: usage-slot-widget

## 1. Estructura HTML del widget

- [x] 1.1 Añadir en `index.html` una nueva sección semántica con identificador propio para el widget "Contador de Tramos", insertada en el flujo vertical de la página tras los indicadores resumen del día y antes del gráfico horario.
- [x] 1.2 Dentro de esa sección, añadir una cabecera con título visible "Contador de Tramos" y una breve descripción para el usuario.
- [x] 1.3 Añadir un bloque de controles con dos campos numéricos etiquetados: uno para la duración en horas y otro para la potencia en vatios, cada uno con su etiqueta visible, unidad y atributos de accesibilidad (label asociado).
- [x] 1.4 Asignar al campo de duración los atributos que reflejen el rango admitido (entero entre 1 y 24) y al campo de potencia los atributos que reflejen su naturaleza (número positivo en vatios), con valores por defecto válidos coherentes con el diseño (duración por defecto 2–3 horas, potencia por defecto en torno a 2000 vatios).
- [x] 1.5 Añadir un contenedor único para el área de salida del widget, que servirá indistintamente para listar los tramos propuestos o para mostrar el mensaje de error o de ausencia de datos (nunca ambos a la vez).

## 2. Estilos CSS del widget

- [x] 2.1 Añadir en `style.css` los estilos de la sección contenedora del widget, reutilizando las variables de tema existentes (paleta oscura, tipografía, radios y márgenes) para que se perciba como parte natural de la aplicación.
- [x] 2.2 Estilizar el bloque de controles para que los dos campos numéricos y sus etiquetas se distribuyan de forma legible en escritorio y se apilen correctamente en pantallas estrechas.
- [x] 2.3 Añadir estilos para el área de resultados como lista de tarjetas o filas, cada una con franja horaria, precio medio en €/MWh y coste estimado en €.
- [x] 2.4 Definir un tratamiento visual diferenciado (color de acento, peso tipográfico o etiqueta textual) para la primera tarjeta de la lista, que corresponde al tramo más barato y recomendado.
- [x] 2.5 Añadir estilos para el estado de mensaje (error de validación o ausencia de datos) dentro del mismo contenedor de resultados, claramente distinguibles de las tarjetas de tramo.

## 3. Estado de la aplicación

- [x] 3.1 En `app.js`, añadir al objeto `state` global tres propiedades nuevas con prefijo identificable del widget: duración solicitada en horas, potencia solicitada en vatios y mensaje de error activo (cadena vacía cuando no hay error).
- [x] 3.2 Inicializar esas tres propiedades con los valores por defecto definidos en el diseño (duración válida, potencia válida, error vacío) para que el primer render produzca tramos visibles en cuanto haya precios.

## 4. Lógica de validación

- [x] 4.1 Implementar una función pura de validación que reciba duración en bruto, potencia en bruto y número de horas con precio disponible, y devuelva un veredicto (válido o no) junto con el mensaje a mostrar al usuario en caso de no serlo.
- [x] 4.2 Cubrir en la validación las reglas: duración entera entre 1 y 24, potencia numérica estrictamente positiva, duración no superior al número de horas con precio disponible del día visualizado, y entradas no numéricas tratadas como inválidas con mensaje específico.

## 5. Lógica de búsqueda de tramos

- [x] 5.1 Implementar una función pura que reciba la serie de precios horarios del día visualizado (cada hora con su precio en €/MWh) y la duración solicitada, y construya todas las ventanas posibles de horas consecutivas de tamaño igual a la duración, cada una con hora de inicio, hora de fin y precio medio.
- [x] 5.2 Ordenar las ventanas resultantes por precio medio ascendente, desempatando por hora de inicio más temprana.
- [x] 5.3 Aplicar una selección codiciosa que recorra el ranking y acepte hasta tres ventanas cuyos rangos horarios no se solapen entre sí, devolviéndolas en el orden en que se aceptaron (que coincide con el orden ascendente de precio medio).
- [x] 5.4 Gestionar los casos límite: cuando la duración iguala las horas disponibles devolver una única ventana que cubre el día; cuando solo caben uno o dos tramos sin solapamiento devolver los que sí caben; cuando no haya datos devolver lista vacía.

## 6. Lógica de cálculo de coste

- [x] 6.1 Implementar una función pura que reciba el precio medio de una ventana en €/MWh, la potencia en vatios y la duración en horas, y devuelva el coste estimado en euros aplicando la fórmula: (precio €/MWh ÷ 1000) × (potencia ÷ 1000) × duración.
- [x] 6.2 Asegurar que la función propaga sin alteración los valores negativos resultantes de precios medios negativos, sin recortar a cero ni cambiar de signo.

## 7. Formato de presentación

- [x] 7.1 Implementar una función auxiliar de formato de franja horaria que reciba hora de inicio y hora de fin enteras y devuelva la cadena `HH:00 – HH:00` en formato de 24 horas.
- [x] 7.2 Implementar (o reutilizar si ya existe en `app.js`) funciones de formato numérico en español que produzcan precio medio en €/MWh y coste estimado en € con coma como separador decimal y dos decimales para el coste.

## 8. Renderizado del widget

- [x] 8.1 Implementar una función de renderizado dedicada al widget que lea del objeto `state` la serie de precios del día visualizado, la duración, la potencia y el mensaje de error activo, y actualice únicamente el contenedor de resultados del widget sin tocar el resto del DOM.
- [x] 8.2 En esa función, encadenar validación → búsqueda de tramos → cálculo de coste por tramo → formato → escritura en el DOM, omitiendo búsqueda y cálculo cuando la validación falle o no haya datos de precios.
- [x] 8.3 Cuando la validación falle o no haya datos disponibles para el día, renderizar el mensaje correspondiente en el contenedor de resultados en lugar de tarjetas de tramo, garantizando que tarjetas y mensaje nunca coexistan.
- [x] 8.4 Renderizar la lista de tramos como tarjetas en orden ascendente de precio medio, aplicando el tratamiento visual destacado a la primera tarjeta.
- [x] 8.5 Cuando la búsqueda devuelva menos de tres tramos por restricciones de duración o disponibilidad, añadir bajo la lista un mensaje informativo indicando que no se pudieron proponer tres tramos para la duración solicitada.

## 9. Eventos de entrada del usuario

- [x] 9.1 Registrar un manejador de evento `input` sobre el campo de duración que actualice la propiedad correspondiente del estado y dispare la función de renderizado del widget.
- [x] 9.2 Registrar un manejador de evento `input` sobre el campo de potencia que actualice la propiedad correspondiente del estado y dispare la función de renderizado del widget.
- [x] 9.3 Verificar que los manejadores invocan únicamente la función de renderizado del widget y no el barrido global de renderizado, para evitar repintar la curva de precios en cada pulsación.

## 10. Integración con el ciclo de precios

- [x] 10.1 Localizar en `app.js` el punto donde se actualizan los precios del día visualizado (carga inicial, cambio de fecha, refresco o caída a modo demo) y donde se invocan las funciones de renderizado existentes.
- [x] 10.2 Añadir en ese mismo punto la invocación a la función de renderizado del widget, de modo que cualquier cambio de la serie de precios recalcule automáticamente los tramos sin requerir acción del usuario y manteniendo los valores actuales de duración y potencia.
- [x] 10.3 Añadir un comentario breve en `app.js` que documente que la función de renderizado del widget debe acompañar siempre a las actualizaciones de la serie de precios, para prevenir desincronizaciones futuras.

## 11. Validación manual contra el spec

- [ ] 11.1 Abrir `index.html` en navegador y comprobar manualmente que los escenarios del spec se cumplen: cálculo reactivo al cambiar duración o potencia, mensajes de error específicos para duración fuera de rango, potencia no positiva o no numérica, y duración mayor que las horas disponibles.
- [ ] 11.2 Verificar manualmente que al cambiar de fecha o al refrescar precios los tramos se recalculan automáticamente, que un día sin datos muestra el mensaje correspondiente, y que el tramo más barato aparece visualmente destacado con cifras en formato español (coma decimal, símbolo €, unidad €/MWh).
