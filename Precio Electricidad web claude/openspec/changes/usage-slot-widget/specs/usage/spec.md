## ADDED Requirements

### Requirement: Entrada de duración y potencia
The system SHALL ofrecer al usuario dos campos numéricos visibles en el widget — duración del uso continuo expresada en horas enteras y potencia del aparato expresada en vatios — y SHALL recalcular los tramos propuestos cada vez que cualquiera de los dos valores cambia a un valor válido.

#### Scenario: Usuario introduce duración y potencia válidas
- **GIVEN** el widget visible con datos de precios disponibles para el día actual
- **WHEN** el usuario introduce una duración de 3 horas y una potencia de 3500 vatios
- **THEN** el widget recalcula y muestra los tramos propuestos para esos parámetros
- **AND** el cálculo se dispara sin necesidad de pulsar un botón adicional

#### Scenario: Usuario modifica la potencia tras un cálculo previo
- **GIVEN** el widget mostrando tramos calculados para 3 horas y 2000 vatios
- **WHEN** el usuario cambia la potencia a 3500 vatios manteniendo la duración
- **THEN** el coste estimado en euros de cada tramo propuesto se actualiza
- **AND** las horas de inicio y fin de los tramos no cambian, porque el ranking depende solo del precio medio

### Requirement: Validación de entradas
The system SHALL rechazar entradas no válidas mostrando un mensaje claro junto al campo afectado y SHALL evitar mostrar tramos calculados con datos inconsistentes mientras la entrada sea inválida.

#### Scenario: Duración fuera del rango permitido
- **GIVEN** el widget visible
- **WHEN** el usuario introduce una duración menor que 1 o mayor que 24
- **THEN** el widget muestra un mensaje indicando el rango permitido (1 a 24 horas)
- **AND** no se muestran tramos propuestos hasta que la entrada se corrija

#### Scenario: Potencia no positiva o no numérica
- **GIVEN** el widget visible
- **WHEN** el usuario introduce una potencia cero, negativa o un texto no numérico
- **THEN** el widget muestra un mensaje indicando que la potencia debe ser un número positivo en vatios
- **AND** no se muestran tramos propuestos hasta que la entrada se corrija

#### Scenario: Duración mayor que las horas disponibles del día
- **GIVEN** un día visualizado con solo 20 horas de datos publicados
- **WHEN** el usuario introduce una duración de 22 horas
- **THEN** el widget muestra un mensaje indicando que la duración solicitada supera las horas disponibles del día
- **AND** no se muestran tramos propuestos

### Requirement: Cálculo de los tres mejores tramos consecutivos
The system SHALL identificar dentro del día actualmente visualizado los tres tramos de horas consecutivas de la duración indicada cuyo precio medio sea más bajo, ordenados de menor a mayor precio medio, y SHALL garantizar que los tres tramos propuestos no se solapen entre sí.

#### Scenario: Día completo con 24 horas y duración de 3 horas
- **GIVEN** una serie de precios horarios completa para el día visualizado
- **AND** una duración solicitada de 3 horas
- **WHEN** el widget calcula los tramos
- **THEN** evalúa todas las ventanas posibles de 3 horas consecutivas
- **AND** propone las tres ventanas de menor precio medio ordenadas ascendentemente
- **AND** ninguna de las tres ventanas propuestas comparte horas con otra ventana propuesta

#### Scenario: Selección sin solapamiento cuando las ventanas óptimas se tocan
- **GIVEN** una duración de 3 horas
- **AND** que la ventana de menor precio medio cubre las horas 02:00–05:00
- **AND** que la siguiente ventana en el ranking por precio medio cubre las horas 03:00–06:00
- **WHEN** el widget selecciona los tramos propuestos
- **THEN** descarta cualquier ventana que comparta horas con un tramo ya seleccionado
- **AND** elige la siguiente ventana del ranking que no se solape con las ya elegidas

#### Scenario: Empate en precio medio entre dos ventanas
- **GIVEN** dos ventanas distintas con idéntico precio medio
- **WHEN** ambas son candidatas a entrar en el ranking
- **THEN** el widget desempata eligiendo la ventana cuya hora de inicio sea más temprana

#### Scenario: Duración igual a las horas disponibles
- **GIVEN** una duración igual al número total de horas disponibles del día
- **WHEN** el widget calcula los tramos
- **THEN** propone exactamente un tramo que cubre todo el día
- **AND** no propone tramos adicionales

#### Scenario: No hay tres tramos sin solapamiento posibles
- **GIVEN** una duración tal que solo caben uno o dos tramos sin solaparse en el día
- **WHEN** el widget calcula los tramos
- **THEN** muestra solo los tramos sin solapamiento que sí caben
- **AND** indica al usuario que no se pudieron proponer tres tramos por la duración solicitada

### Requirement: Cálculo del coste estimado de cada tramo
The system SHALL calcular para cada tramo propuesto un coste estimado en euros aplicando la fórmula: coste en euros = (precio medio del tramo en euros por kilovatio hora) × (potencia en vatios ÷ 1000) × (duración en horas), donde el precio medio en euros por kilovatio hora SHALL obtenerse dividiendo el precio medio del tramo en euros por megavatio hora entre 1000.

#### Scenario: Cálculo de coste para lavadora
- **GIVEN** un tramo propuesto con precio medio de 80 €/MWh
- **AND** una potencia de 3500 vatios y una duración de 3 horas
- **WHEN** el widget calcula el coste estimado
- **THEN** convierte el precio a 0,08 €/kWh
- **AND** obtiene un coste estimado de 0,84 €

#### Scenario: Cálculo de coste para horno
- **GIVEN** un tramo propuesto con precio medio de 120 €/MWh
- **AND** una potencia de 2200 vatios y una duración de 5 horas
- **WHEN** el widget calcula el coste estimado
- **THEN** convierte el precio a 0,12 €/kWh
- **AND** obtiene un coste estimado de 1,32 €

#### Scenario: Precio medio negativo
- **GIVEN** un tramo cuyo precio medio es negativo (excedente renovable)
- **WHEN** el widget calcula el coste estimado
- **THEN** el coste estimado resultante es un valor negativo
- **AND** se muestra al usuario tal cual, indicando ahorro

### Requirement: Presentación de los tramos propuestos
The system SHALL mostrar cada tramo propuesto con su hora de inicio, su hora de fin, su precio medio en euros por megavatio hora y su coste estimado en euros, y SHALL presentar la lista ordenada de menor a mayor precio medio destacando visualmente el tramo más barato.

#### Scenario: Formato de horas
- **GIVEN** un tramo que cubre desde la hora 14 hasta la hora 17
- **WHEN** el widget lo presenta
- **THEN** muestra la franja como "14:00 – 17:00"
- **AND** el formato de hora es de 24 horas

#### Scenario: Formato de cifras numéricas en español
- **GIVEN** un tramo con precio medio de 87,5 €/MWh y coste estimado de 1,23 €
- **WHEN** el widget lo presenta
- **THEN** las cifras se muestran con coma como separador decimal
- **AND** el coste estimado se muestra con dos decimales y el símbolo €
- **AND** el precio medio se muestra con la unidad €/MWh

#### Scenario: Tramo más barato destacado
- **GIVEN** una lista de tres tramos propuestos
- **WHEN** el widget los presenta
- **THEN** el tramo con menor precio medio aparece visualmente destacado respecto a los otros dos

### Requirement: Reactividad ante cambios del día visualizado
The system SHALL recalcular los tramos propuestos automáticamente cuando los precios del día visualizado cambian (carga inicial, cambio de fecha o refresco de datos) sin requerir interacción adicional del usuario y manteniendo los valores actuales de duración y potencia.

#### Scenario: Carga inicial de precios
- **GIVEN** la aplicación cargando precios del día por primera vez
- **AND** valores por defecto válidos de duración y potencia en el widget
- **WHEN** los precios quedan disponibles
- **THEN** el widget muestra los tramos propuestos sin acción del usuario

#### Scenario: Cambio de día visualizado
- **GIVEN** el widget mostrando tramos para el día de hoy
- **WHEN** el usuario cambia el día visualizado a otra fecha
- **THEN** el widget recalcula los tramos con los precios de la nueva fecha
- **AND** mantiene los valores actuales de duración y potencia

### Requirement: Comportamiento ante ausencia de datos
The system SHALL detectar la ausencia de datos de precios para el día visualizado y SHALL comunicar al usuario que el cálculo no es posible en lugar de mostrar tramos vacíos, erróneos o con coste cero.

#### Scenario: Día sin datos de precios
- **GIVEN** un día visualizado para el que no hay precios disponibles
- **WHEN** el usuario introduce una duración y una potencia válidas
- **THEN** el widget no muestra tramos propuestos
- **AND** muestra un mensaje indicando que no hay datos de precios para ese día

#### Scenario: Datos parciales del día
- **GIVEN** un día con solo una parte de las horas publicadas
- **WHEN** el widget calcula los tramos
- **THEN** considera solo las horas con precio disponible
- **AND** los tramos propuestos solo cubren franjas con datos reales
