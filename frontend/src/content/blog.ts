/**
 * Contenido de los artículos del blog público (SEO), en el mismo formato
 * ligero que los resúmenes de tema — "## " para encabezados, "- " para
 * listas, línea suelta para párrafo — así reutilizan EsquemaResumen sin
 * añadir una librería de markdown. Datos versionados aquí mismo (no hay
 * CMS): añadir un artículo es añadir una entrada a este array.
 */
export interface EntradaBlog {
  slug: string;
  titulo: string;
  descripcion: string;
  fechaPublicacion: string;
  cuerpo: string;
}

export const ENTRADAS_BLOG: EntradaBlog[] = [
  {
    slug: "temario-auxiliar-administrativo-estado",
    titulo: "Temario de Auxiliar Administrativo del Estado: los 28 temas y cómo se examinan",
    descripcion:
      "Los 28 temas del temario oficial de Auxiliar Administrativo del Estado, organizados en Bloque I y Bloque II, y cómo se estructura el examen: partes, número de preguntas y tiempo.",
    fechaPublicacion: "2026-09-29",
    cuerpo: `El temario de Auxiliar Administrativo del Estado se divide en dos bloques con un total de 28 temas: 16 en el Bloque I (organización del Estado) y 12 en el Bloque II (actividad administrativa y ofimática).

## Bloque I: organización pública

Este bloque cubre el marco constitucional e institucional del Estado, desde la Constitución hasta la organización territorial y la Unión Europea.

- La Constitución Española de 1978
- El Tribunal Constitucional. Reforma constitucional. La Corona
- Las Cortes Generales
- El Poder Judicial
- El Gobierno y la Administración
- El Gobierno Abierto
- La Ley de Transparencia
- La Administración General del Estado
- La organización territorial del Estado
- La organización de la Unión Europea
- Ley 39/2015 y Ley 40/2015
- La protección de datos personales
- El personal funcionario
- Derechos y deberes de los funcionarios
- El presupuesto del Estado en España
- Políticas de igualdad y contra la violencia de género

## Bloque II: actividad administrativa y ofimática

Este bloque es más práctico: atención al ciudadano, gestión documental y el manejo de las aplicaciones de Microsoft 365 que se usan en cualquier puesto administrativo.

- Atención al público
- Los servicios de información administrativa
- Documento, registro y archivo
- Administración electrónica y servicios al ciudadano
- Informática básica
- Introducción al sistema operativo: el entorno Windows
- El explorador de Windows
- Procesadores de texto: Word
- Hojas de cálculo: Excel
- Bases de datos: Access
- Correo electrónico: Outlook
- La Red Internet

## Cómo se estructura el examen

En la convocatoria general, el primer ejercicio (el que elimina a la mayoría de opositores) se divide en dos partes dentro de la misma sesión.

- Parte 1: 60 preguntas tipo test en 90 minutos — 30 sobre el Bloque I y 30 de carácter psicotécnico (numéricas, verbales, de razonamiento).
- Parte 2: 50 preguntas tipo test en 45 minutos, todas sobre el Bloque II (ofimática y actividad administrativa).

Cada convocatoria puede variar ligeramente estos números o el sistema de corrección, así que conviene confirmarlos siempre en las bases publicadas en el BOE antes de dar nada por fijo.

## Cómo prepararlo

Con 28 temas y un bloque entero de psicotécnicos, intentar memorizarlo todo de golpe no funciona bien: rinde más repartir el repaso en el tiempo y practicar con preguntas tipo test desde el primer día, en vez de dejarlo para el final.

Puedes ver el resumen de estudio de cada uno de los 28 temas, con test de preguntas verificadas incluido, en el temario completo de Aprobox.`,
  },
  {
    slug: "requisitos-auxiliar-administrativo-estado",
    titulo: "Requisitos para ser Auxiliar Administrativo del Estado",
    descripcion:
      "Qué titulación, edad y nacionalidad se piden para opositar a Auxiliar Administrativo del Estado, y qué otros requisitos hay que cumplir antes de presentar la solicitud.",
    fechaPublicacion: "2026-09-29",
    cuerpo: `Los requisitos para presentarse a la oposición de Auxiliar Administrativo del Estado son pocos y accesibles en comparación con otros cuerpos de la Administración — es precisamente uno de los motivos por los que recibe tantas solicitudes cada convocatoria.

## Titulación

Se exige estar en posesión del título de Graduado en Educación Secundaria Obligatoria (ESO) o de una titulación equivalente: el antiguo Graduado Escolar (EGB), Formación Profesional de primer grado, un certificado de profesionalidad de nivel 2, o un título extranjero homologado a alguno de los anteriores.

No hace falta ninguna titulación superior ni experiencia previa en la Administración.

## Edad

Hay que haber cumplido 16 años. No existe un límite máximo de edad para presentarse, salvo la edad ordinaria de jubilación forzosa — es habitual ver opositores de 40, 50 o más años preparando esta plaza.

## Nacionalidad

Se pide tener nacionalidad española o la de un Estado miembro de la Unión Europea (también se admite, con matices, a familiares de ciudadanos comunitarios y, en determinados casos, a nacionales de terceros países con residencia legal, según lo que fijen las bases de cada convocatoria).

## Otros requisitos

- No haber sido separado, mediante expediente disciplinario, del servicio de ninguna Administración Pública.
- No estar inhabilitado para el ejercicio de funciones públicas.
- Poseer la capacidad funcional para el desempeño de las tareas del puesto.

Todos estos requisitos deben cumplirse dentro del plazo de presentación de solicitudes, no en el momento del examen ni al final del proceso.

## Antes de presentar la solicitud

Las condiciones concretas (plazos, tasas, adaptaciones para personas con discapacidad, cupos de reserva) las fija cada convocatoria en el BOE, así que conviene revisar siempre las bases oficiales publicadas antes de inscribirse, y no fiarse solo de un resumen como este.

Si cumples los requisitos y quieres empezar a preparar el temario, puedes practicar gratis con el banco de preguntas verificadas de Aprobox.`,
  },
  {
    slug: "sueldo-auxiliar-administrativo-estado",
    titulo: "Sueldo de un Auxiliar Administrativo del Estado: cuánto se cobra",
    descripcion:
      "Cuánto cobra en neto un Auxiliar Administrativo del Estado (grupo C2): sueldo base, complementos, trienios y por qué varía según el destino.",
    fechaPublicacion: "2026-09-29",
    cuerpo: `El Auxiliar Administrativo del Estado pertenece al Subgrupo C2, el de titulación de acceso más básica dentro de la función pública, pero eso no significa que el sueldo sea uniforme: varía bastante según el organismo y el puesto concreto de destino.

## De qué se compone el sueldo

El sueldo no es una única cifra, sino la suma de varios conceptos.

- Sueldo base: fijado cada año para todo el Subgrupo C2, igual para cualquier destino.
- Trienios: una cantidad fija que se suma cada tres años de antigüedad en la Administración.
- Complemento de destino: depende del nivel del puesto concreto (habitualmente nivel 14 para este cuerpo).
- Complemento específico: es el que más varía entre organismos, y compensa dificultad técnica, dedicación o penosidad del puesto.
- Pagas extraordinarias: dos al año, en junio y diciembre.

## Cuánto es en la práctica

En un puesto de entrada, sin trienios ni complementos altos, el neto mensual suele moverse entre 1.150 y 1.350 euros aproximadamente. En organismos con complementos específicos más altos (como la Seguridad Social o el SEPE) o con la antigüedad de varios trienios acumulados, la cifra puede acercarse o superar los 1.600 euros netos al mes.

Esta horquilla es orientativa: el importe exacto depende de la nómina real de cada organismo, de las retenciones de IRPF de cada persona y de la convocatoria vigente en cada momento, así que conviene tomarla como una referencia, no como una cifra cerrada.

## Estabilidad, no solo sueldo

Buena parte del atractivo de esta oposición no está solo en el sueldo de entrada, sino en lo que viene después: plaza fija, progresión por antigüedad y concursos de traslado, y la posibilidad de promocionar internamente a cuerpos superiores con el tiempo.

Si te estás planteando esta oposición, el primer paso realista es comprobar cuánto sabes ya del temario — puedes hacerlo gratis con el test de nivel de Aprobox.`,
  },
  {
    slug: "como-estudiar-auxiliar-administrativo-estado",
    titulo: "Cómo estudiar para el examen de Auxiliar Administrativo del Estado",
    descripcion:
      "Plan de estudio realista para preparar Auxiliar Administrativo del Estado: cómo repartir los 28 temas, cuándo empezar a hacer tests y cómo no olvidar lo que ya has estudiado.",
    fechaPublicacion: "2026-09-29",
    cuerpo: `Con 28 temas y un bloque entero de psicotécnicos, el error más habitual al preparar esta oposición es leer el temario entero antes de hacer un solo test — y llegar al examen sin haber practicado el formato real.

## Empieza a hacer tests desde el primer tema

No hace falta dominar un tema para empezar a practicar con preguntas sobre él. Hacer tests desde el principio cumple dos funciones a la vez: fija lo que acabas de leer, y te enseña qué matices suele preguntar el examen que un resumen no destaca por sí solo.

## Reparte el repaso, no lo amontones al final

Leer un tema una vez no basta para retenerlo semanas después. Repasar cada tema varias veces, espaciando cada repaso un poco más que el anterior, es mucho más eficaz que releer todo el temario de golpe la semana antes del examen — es la lógica de la repetición espaciada, y es literalmente cómo está construido el modo "Repasar hoy" de Aprobox: cada día te propone justo lo que te toca repasar según cómo te haya ido antes.

## No descuides el Bloque II ni los psicotécnicos

Es habitual centrar todo el esfuerzo en el Bloque I (Constitución, Cortes Generales, Poder Judicial...) por parecer "lo importante", y dejar de lado el Bloque II de ofimática o los psicotécnicos por parecer más fáciles. En el examen real pesan igual o más: 50 de las 110 preguntas son de Bloque II, y otras 30 son psicotécnicas.

## Haz simulacros cronometrados antes del examen

Practicar preguntas sueltas por tema es necesario, pero no sustituye a hacer un simulacro completo, con el mismo número de preguntas y el mismo límite de tiempo que el examen real. Llegar el día del examen sin haber sentido antes esa presión de tiempo es la forma más fácil de perder puntos por prisas, no por desconocimiento.

## Prioriza en función de tus fallos, no de tus gustos

Es tentador repasar más los temas que ya dominas, porque sienta bien acertar. Rinde mucho más revisar en qué tema fallas de verdad y dedicarle ahí el tiempo extra — es la diferencia entre sentirte bien estudiando y aprobar.

Puedes aplicar este plan directamente: consulta el temario completo con resumen de cada tema, practica con el banco de preguntas verificadas, y deja que la app te diga cada día qué te toca repasar.`,
  },
];

export function obtenerEntradaBlog(slug: string): EntradaBlog | undefined {
  return ENTRADAS_BLOG.find((entrada) => entrada.slug === slug);
}
