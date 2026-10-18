import pdfLib from './vendor/pdf-lib.cjs';

const {PDFDocument, StandardFonts, rgb, PageSizes} = pdfLib;
const margin = 46;
const bottom = 69;
const ink = rgb(0.14, 0.17, 0.20);
const muted = rgb(0.38, 0.42, 0.46);
const rule = rgb(0.76, 0.79, 0.82);
const shade = rgb(0.93, 0.94, 0.95);

function printable(value) {
  return String(value ?? '').normalize('NFKC')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2022\u00b7]/g, '-')
    .replace(/[^\x20-\x7e\xa0-\xff\n]/g, '?');
}

function date(value) {
  if(!value) return 'No consta';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? printable(value) : new Intl.DateTimeFormat('es-PE', {
    dateStyle:'medium', timeStyle:'short', timeZone:'America/Lima'
  }).format(parsed);
}

function wrap(value, font, size, width) {
  const result = [];
  for(const paragraph of printable(value).split('\n')) {
    if(!paragraph.trim()) { result.push(''); continue; }
    let current = '';
    for(const word of paragraph.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if(font.widthOfTextAtSize(candidate,size)<=width) { current=candidate; continue; }
      if(current) { result.push(current); current=''; }
      let part='';
      for(const char of word) {
        if(part && font.widthOfTextAtSize(part+char,size)>width) { result.push(part); part=''; }
        part+=char;
      }
      current=part;
    }
    if(current) result.push(current);
  }
  return result;
}

function value(item) {
  return item===null||item===undefined||item==='' ? 'No consta' : String(item);
}

function caseRef(id) { return `#${String(id).slice(-8).toUpperCase()}`; }
function percent(number) { return number===null||number===undefined?'No consta':`${Math.round(Number(number)*100)} %`; }

/** Renders the saved, authorized snapshot for one complete identified group. */
export async function renderReportPdf(report) {
  const pdf=await PDFDocument.create();
  pdf.setTitle(`Informe preliminar - ${report.title} - v${report.version}`);
  pdf.setAuthor('Tiskz - panel de análisis');
  pdf.setSubject('Informe preliminar de un conjunto de casos ficticios');
  const regular=await pdf.embedFont(StandardFonts.Helvetica);
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const [width,height]=PageSizes.A4;
  const contentWidth=width-margin*2;
  let page;
  let y;
  function newPage() {
    page=pdf.addPage([width,height]);
    y=height-83;
  }
  function ensure(space) { if(y-space<bottom) newPage(); }
  function paragraph(content,{size=9,font=regular,color=ink,gap=8,indent=0}={}) {
    const lineHeight=size*1.42;
    for(const line of wrap(value(content),font,size,contentWidth-indent)) {
      ensure(lineHeight);
      if(line) page.drawText(line,{x:margin+indent,y,size,font,color});
      y-=lineHeight;
    }
    y-=gap;
  }
  function section(number,title,minSpace=95) {
    ensure(minSpace);
    y-=10;
    page.drawText(`${number}. ${printable(title)}`,{x:margin,y,size:11,font:bold,color:ink});
    y-=9;
    page.drawLine({start:{x:margin,y},end:{x:width-margin,y},thickness:0.6,color:rule});
    y-=13;
  }
  function subsection(title) {
    ensure(65);
    y-=6;
    paragraph(title,{size:9.5,font:bold,gap:4});
  }
  function table(columns,rows,title=null) {
    const widths=columns.map(column=>column.width*contentWidth);
    const size=8.2;
    const lineHeight=11.3;
    const padding=5;
    const tableFont=regular;
    const textRows=rows.map(row=>row.map((cell,index)=>wrap(value(cell),tableFont,size,widths[index]-padding*2)));
    const totalHeight=24+textRows.reduce((sum,cells)=>sum+
      Math.max(...cells.map(cell=>cell.length),1)*lineHeight+padding*2,0);
    if(title) {
      ensure(totalHeight+37<=height-83-bottom?totalHeight+37:90);
      subsection(title);
    } else if(totalHeight<=height-83-bottom) ensure(totalHeight+14);
    function drawRow(cells,height,header=false) {
      let x=margin;
      for(let index=0;index<cells.length;index++) {
        page.drawRectangle({x,y:y-height,width:widths[index],height,
          borderColor:rule,borderWidth:0.5,color:header?shade:rgb(1,1,1)});
        for(const [lineIndex,line] of cells[index].entries()) {
          if(line) page.drawText(line,{x:x+padding,y:y-padding-size-lineIndex*lineHeight,
            size,font:header?bold:tableFont,color:ink});
        }
        x+=widths[index];
      }
      y-=height;
    }
    function header() {
      ensure(47);
      drawRow(columns.map(column=>[printable(column.label)]),24,true);
    }
    header();
    for(const cells of textRows) {
      let offset=0;
      const maxLength=Math.max(...cells.map(cell=>cell.length),1);
      while(offset<maxLength) {
        if(y-bottom<35) { newPage(); header(); }
        const available=Math.max(1,Math.floor((y-bottom-padding*2)/lineHeight));
        const count=Math.min(maxLength-offset,available);
        const fragment=cells.map(cell=>cell.slice(offset,offset+count));
        drawRow(fragment,count*lineHeight+padding*2);
        offset+=count;
        if(offset<maxLength) { newPage(); header(); }
      }
    }
    y-=14;
  }
  function twoColumn(rows,title=null) {
    table([{label:'Campo',width:0.28},{label:'Información registrada',width:0.72}],rows,title);
  }

  newPage();
  paragraph('INFORME PRELIMINAR DE VINCULACIÓN DE CASOS',{size:16,font:bold,gap:7});
  paragraph(report.title,{size:11,font:bold,gap:14});
  twoColumn([
    ['Entidad que prepara',report.snapshot.organization.name],
    ['Versión',`${report.version} - ${report.id}`],
    ['Fecha de emisión',date(report.created_at)],
    ['Preparado por',report.created_by_name],
    ['Alcance',`${report.snapshot.cases.length} casos y ${report.snapshot.links.length} vínculos del conjunto identificado`],
    ['Carácter','Documento de prueba con casos ficticios. Requiere revisión humana antes de cualquier remisión.'],
  ]);

  section(1,'Objeto y alcance');
  paragraph('Este documento reúne los hallazgos guardados sobre un conjunto de reportes relacionados. Describe coincidencias observadas y el estado de revisión de cada vínculo. Las puntuaciones son indicativas; no establecen que los casos correspondan a una misma persona.');
  paragraph(report.snapshot.caveat,{font:bold});

  section(2,'Resumen ejecutivo');
  const confirmed=report.snapshot.links.filter(link=>link.status==='confirmado').length;
  const pending=report.snapshot.links.filter(link=>link.status==='pendiente').length;
  twoColumn([
    ['Casos documentados',report.snapshot.cases.length],
    ['Vínculos confirmados',confirmed],
    ['Vínculos pendientes',pending],
    ['Fuente del análisis','Resúmenes y hallazgos Maritime, coincidencias deterministas y decisiones de analistas.'],
  ]);
  paragraph(report.summary,{size:9});

  section(3,'Relación de casos del conjunto');
  table([
    {label:'Caso',width:0.15},{label:'Fecha de inicio',width:0.25},
    {label:'Canal',width:0.18},{label:'Riesgo',width:0.18},{label:'Clasificación',width:0.24},
  ],report.snapshot.cases.map(item=>[
    caseRef(item.id),date(item.started_at),item.channel,
    `${value(item.risk_level)} (${value(item.risk_score)}/100)`,item.verdict,
  ]));

  section(4,'Hallazgos por caso');
  for(const [index,item] of report.snapshot.cases.entries()) {
    twoColumn([
      ['Identificador',item.id],['Inicio',date(item.started_at)],['Cierre',date(item.ended_at)],
      ['Canal',item.channel],['Estado',item.status],['Clasificación',item.verdict],
      ['Riesgo',`${value(item.risk_level)} (${value(item.risk_score)}/100)`],
      ['Tipo de estafa',item.scam_type],['Suplantación declarada',item.impersonating],
      ['Número reportado',item.caller_e164||item.caller_number_raw],
      ['Modelo Maritime',item.maritime.model_id],['Versión de análisis',item.maritime.prompt_version],
    ],`${index+1}. ${caseRef(item.id)} - ${item.title}`);
    paragraph(`Resumen del caso: ${value(item.summary)}`);
    paragraph(`Recomendación registrada: ${value(item.recommendation)}`);
    if(item.signals.length) {
      subsection('Señales registradas');
      table([{label:'Tipo',width:0.17},{label:'Explicación e indicio',width:0.65},{label:'Confianza / fuente',width:0.18}],
        item.signals.map(signal=>[signal.type,
          `${signal.explanation}${signal.evidence?`\nIndicio: ${signal.evidence}`:''}`,
          `${percent(signal.confidence)} / ${value(signal.source)}`]));
    }
    if(item.entities.length) {
      subsection('Identificadores mencionados');
      table([{label:'Tipo',width:0.20},{label:'Valor',width:0.52},{label:'Procedencia',width:0.28}],
        item.entities.map(entity=>[entity.kind,entity.value,entity.provenance]));
    }
    if(item.maritime.limitations.length) {
      subsection('Limitaciones del análisis Maritime');
      item.maritime.limitations.forEach((limitation,index)=>paragraph(`${index+1}. ${limitation}`,{size:8.5,gap:3}));
    }
  }

  section(5,'Vínculos y fundamentos',155);
  table([{label:'Casos relacionados',width:0.29},{label:'Estado',width:0.18},
    {label:'Puntuación',width:0.18},{label:'Fundamento registrado',width:0.35}],
  report.snapshot.links.map(link=>[
    `${caseRef(link.incident_a)} / ${caseRef(link.incident_b)}`,link.status,percent(link.score),
    link.reasons.map(reason=>reason.detail).join('; ')||'No consta',
  ]));
  for(const [index,link] of report.snapshot.links.entries()) {
    twoColumn([
      ['ID del vínculo',link.id],['Casos (IDs)',`${link.incident_a} / ${link.incident_b}`],
      ['Estado al guardar',link.status],['Puntuación indicativa',percent(link.score)],
      ['Similitud de contenido',percent(link.content_sim)],['Similitud de voz',percent(link.voice_sim)],
      ['Versión de evidencia',link.evidence_version],
      ['Revisión humana',link.reviewed_at?`${value(link.reviewed_by)} - ${date(link.reviewed_at)}`:'Pendiente o no registrada'],
      ['Versión revisada',link.reviewed_evidence_version],['Nota del analista',link.note],
    ],`${index+1}. ${caseRef(link.incident_a)} / ${caseRef(link.incident_b)}`);
    if(link.reasons.length) table([{label:'Tipo de coincidencia',width:0.30},{label:'Detalle',width:0.70}],
      link.reasons.map(reason=>[reason.kind,reason.detail]));
    const reviewedSnapshot=link.reviewed_evidence?.evidence_snapshot;
    const comparison=(link.status==='confirmado'&&reviewedSnapshot
      ?reviewedSnapshot:link.evidence_snapshot)?.ai_explanation;
    if(comparison?.status==='completed') {
      twoColumn([
        ['Comportamiento',comparison.behavior_similarity],
        ['Resumen del caso A',comparison.evidence_a],['Resumen del caso B',comparison.evidence_b],
        ['Modelo',comparison.model_id],['Versión de análisis',comparison.prompt_version],
        ['Fecha de comparación',date(comparison.generated_at)],
        ['Limitaciones',Array.isArray(comparison.limitations)?comparison.limitations.join('; '):null],
      ],'Comparación Maritime');
    } else paragraph('No consta una comparación Maritime completa al guardar esta versión.',{color:muted});
  }

  section(6,'Limitaciones y trazabilidad',190);
  paragraph('Los identificadores y coincidencias son indicios sujetos a verificación independiente. Este documento no identifica a un presunto autor, no determina culpabilidad y no equivale a una denuncia presentada ante la autoridad. No incluye audio ni transcripciones íntegras.');
  twoColumn([
    ['ID de versión',report.id],['Serie',report.series_id],
    ['Captura de evidencia',date(report.snapshot.captured_at)],
    ['SHA-256 del contenido',report.content_sha256],
  ]);
  paragraph('El hash corresponde al contenido de la versión guardada en la web, no a los bytes del archivo PDF.',{size:8,color:muted});

  const pages=pdf.getPages();
  for(const [index,current] of pages.entries()) {
    current.drawText('TISKZ  |  INFORME PRELIMINAR DE ANÁLISIS',{x:margin,y:height-34,size:8.5,font:bold,color:ink});
    current.drawText('CASOS FICTICIOS - PRUEBA',{x:width-margin-132,y:height-34,size:7.5,font:bold,color:muted});
    current.drawLine({start:{x:margin,y:height-44},end:{x:width-margin,y:height-44},thickness:0.7,color:rule});
    current.drawLine({start:{x:margin,y:52},end:{x:width-margin,y:52},thickness:0.6,color:rule});
    current.drawText('TISKZ | documento preliminar | casos ficticios',{x:margin,y:36,size:7.5,font:regular,color:muted});
    current.drawText(`Página ${index+1} de ${pages.length}`,{x:width-margin-70,y:36,size:7.5,font:regular,color:muted});
  }
  return pdf.save();
}
