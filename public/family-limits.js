// Campos de limite usam texto com teclado numérico para evitar coerção nativa
// do input[type=number] durante a edição em navegadores móveis.
// Nunca substitua um valor inválido pelo padrão do evento.
export function parseFamilyLimit(value,{minimum=0,maximum=100}={}){
 const raw=String(value??"").trim();
 if(!raw)return null;
 if(!/^[0-9]{1,3}$/.test(raw))return NaN;
 const parsed=Number(raw);
 return Number.isSafeInteger(parsed)&&parsed>=minimum&&parsed<=maximum?parsed:NaN;
}

export function effectiveFamilyLimit(value,eventDefault){
 const individual=parseFamilyLimit(value,{minimum:1});
 if(individual!==null)return individual;
 const fallback=parseFamilyLimit(eventDefault,{minimum:1});
 return Number.isNaN(fallback)?null:fallback;
}
