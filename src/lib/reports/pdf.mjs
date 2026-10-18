import pdfLib from './vendor/pdf-lib.cjs';

const {PDFDocument, StandardFonts, rgb, PageSizes} = pdfLib;
const margin = 48;
const ink = rgb(0.10, 0.16, 0.23);
const muted = rgb(0.35, 0.41, 0.48);
const accent = rgb(0.04, 0.36, 0.45);
const lineColor = rgb(0.83, 0.86, 0.88);

function printable(value) {
  return String(value ?? '').normalize('NFKC')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2022\u00b7]/g, '-')
    .replace(/[\u2190-\u21ff]/g, '<->')
    .replace(/[^\x20-\x7e\xa0-\xff\n]/g, '?');
}

function date(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? printable(value) : new Intl.DateTimeFormat('es-PE', {
    dateStyle:'medium', timeStyle:'short', timeZone:'America/Lima'
  }).format(parsed);
}

function lines(text, font, size, width) {
  const output=[];
  for(const paragraph of printable(text).split('\n')) {
    if(!paragraph.trim()) { output.push(''); continue; }
    let current='';
    for(const word of paragraph.split(/\s+/)) {
      const candidate=current ? `${current} ${word}` : word;
      if(font.widthOfTextAtSize(candidate,size)<=width) { current=candidate; continue; }
      if(current) { output.push(current); current=''; }
      let fragment='';
      for(const char of word) {
        if(fragment && font.widthOfTextAtSize(fragment+char,size)>width) {
          output.push(fragment); fragment='';
        }
        fragment+=char;
      }
      current=fragment;
    }
    if(current) output.push(current);
  }
  return output;
}

/** Render only the saved report version. No model or live incident reads occur here. */
export async function renderReportPdf(report) {
  const pdf=await PDFDocument.create();
  pdf.setTitle(`${report.title} - versión ${report.version}`);
  pdf.setAuthor('Tiskz - panel de análisis');
  pdf.setSubject('Informe preliminar de casos ficticios');
  const regular=await pdf.embedFont(StandardFonts.Helvetica);
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const [width,height]=PageSizes.A4;
  let page;
  let y;
  const newPage=()=>{
    page=pdf.addPage([width,height]); y=height-96;
    page.drawText('TISKZ  /  INFORME PRELIMINAR',{x:margin,y:height-37,size:9,font:bold,color:accent});
    page.drawText('PRUEBA - CASOS FICTICIOS',{x:width-margin-154,y:height-37,size:8,font:bold,color:accent});
    page.drawLine({start:{x:margin,y:height-49},end:{x:width-margin,y:height-49},thickness:0.8,color:lineColor});
  };
  const ensure=(space)=>{if(y-space<67)newPage();};
  const write=(value,{size=10,font=regular,color=ink,indent=0,gap=7}={})=>{
    const lineHeight=size*1.42;
    for(const part of lines(value,font,size,width-margin*2-indent)) {
      ensure(lineHeight);
      if(part) page.drawText(part,{x:margin+indent,y,size,font,color});
      y-=lineHeight;
    }
    y-=gap;
  };
  const heading=(label)=>{
    ensure(44); y-=9;
    write(label,{font:bold,size:13,color:accent,gap:7});
  };
  const fact=(label,value)=>{if(value!==null&&value!==undefined&&value!=='') write(`${label}: ${value}`,{size:9,gap:2});};
  newPage();
  write(report.title,{font:bold,size:20,color:ink,gap:8});
  write(`Versión ${report.version}  |  ${printable(report.snapshot.organization.name)}  |  ${date(report.created_at)}`,{size:9,color:muted,gap:7});
  write(`Preparado por ${report.created_by_name}. ${report.snapshot.cases.length} casos ficticios; ${report.snapshot.links.length} vínculos seleccionados.`,{size:9,gap:9});
  heading('Alcance y advertencia');
  write(report.snapshot.caveat,{size:10,gap:4});
  write('Borrador para revisión del analista. No constituye denuncia enviada ni atribución de identidad o culpabilidad.',{size:9,font:bold,color:accent,gap:9});
  heading('Resumen de hallazgos');
  write(report.summary,{size:10,gap:10});

  heading('Casos documentados');
  for(const [index,item] of report.snapshot.cases.entries()) {
    ensure(210);
    write(`${index+1}. ${item.title} (#${item.id.slice(-8).toUpperCase()})`,{font:bold,size:11,gap:3});
    fact('ID de caso',item.id);
    fact('Inicio',date(item.started_at));
    if(item.ended_at) fact('Cierre',date(item.ended_at));
    fact('Canal',item.channel);
    fact('Riesgo estimado',`${item.risk_level} (${item.risk_score}/100)`);
    fact('Clasificación',item.verdict);
    if(item.scam_type) fact('Tipo de estafa',item.scam_type);
    if(item.caller_e164||item.caller_number_raw) fact('Número reportado',item.caller_e164||item.caller_number_raw);
    write(`Resumen Maritime: ${item.summary||'No disponible'}`,{size:9,gap:3});
    if(item.recommendation) write(`Recomendación: ${item.recommendation}`,{size:9,gap:3});
    if(item.signals.length) {
      write('Señales registradas:',{font:bold,size:9,gap:1});
      for(const signal of item.signals) write(`- ${signal.type}: ${signal.explanation}${signal.evidence?` (indicio: ${signal.evidence})`:''}`,{size:9,indent:9,gap:1});
    }
    if(item.entities.length) {
      write('Datos mencionados:',{font:bold,size:9,gap:1});
      for(const entity of item.entities) write(`- ${entity.kind}: ${entity.value} (${entity.provenance})`,{size:9,indent:9,gap:1});
    }
    if(item.maritime.limitations.length) write(`Limitaciones: ${item.maritime.limitations.join('; ')}`,{size:9,color:muted,gap:3});
    fact('Modelo Maritime',item.maritime.model_id);
    y-=8;
  }

  heading('Vínculos y fundamentos');
  for(const [index,link] of report.snapshot.links.entries()) {
    ensure(70);
    write(`${index+1}. Casos #${link.incident_a.slice(-8).toUpperCase()} / #${link.incident_b.slice(-8).toUpperCase()}`,{font:bold,size:11,gap:3});
    fact('IDs relacionados',`${link.incident_a} / ${link.incident_b}`);
    fact('Estado al guardar',link.status);
    fact('Puntuación indicativa',`${Math.round(link.score*100)}%`);
    fact('Versión de evidencia',link.evidence_version);
    if(link.reviewed_at) fact('Revisión humana',`${link.reviewed_by||'Analista'} - ${date(link.reviewed_at)}`);
    for(const reason of link.reasons) write(`- ${reason.detail}`,{size:9,indent:9,gap:1});
    const ai=link.evidence_snapshot?.ai_explanation;
    if(ai?.status==='completed') {
      fact('Comparación Maritime',ai.behavior_similarity);
      if(ai.evidence_a) fact('Fragmento del resumen A',ai.evidence_a);
      if(ai.evidence_b) fact('Fragmento del resumen B',ai.evidence_b);
      if(Array.isArray(ai.limitations)&&ai.limitations.length) write(`Limitaciones: ${ai.limitations.join('; ')}`,{size:9,color:muted,gap:3});
    } else {
      write('Sin comparación Maritime completa al guardar esta versión.',{size:9,color:muted,gap:3});
    }
    y-=8;
  }
  heading('Trazabilidad');
  fact('ID de versión',report.id);
  fact('Serie',report.series_id);
  fact('Captura',date(report.snapshot.captured_at));
  write(`SHA-256 del contenido guardado: ${report.content_sha256}`,{size:8,color:muted,gap:2});
  write('El hash corresponde al contenido de la versión guardada en la web, no al archivo PDF.',{size:8,color:muted,gap:2});
  const pages=pdf.getPages();
  for(const [index,current] of pages.entries()) {
    current.drawLine({start:{x:margin,y:51},end:{x:width-margin,y:51},thickness:0.8,color:lineColor});
    current.drawText('TISKZ - uso interno de prueba',{x:margin,y:36,size:8,font:regular,color:muted});
    current.drawText(`${index+1} / ${pages.length}`,{x:width-margin-35,y:36,size:8,font:regular,color:muted});
  }
  return pdf.save();
}
