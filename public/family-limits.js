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

/**
 * Unfilled seats in flexible invitations. Only confirmed attendees occupy a seat.
 * An undefined event limit must NOT trigger the final review prompt.
 */
export function flexibleRemainingSlots({composition=false,adultLimit=null,childLimit=null,limit=null,confirmedAdults=0,confirmedChildren=0}={}){
 const usedAdults=Math.max(0,Number(confirmedAdults)||0);
 const usedChildren=Math.max(0,Number(confirmedChildren)||0);
 if(composition){
  return {adults:Math.max(0,(Number(adultLimit)||0)-usedAdults),
    children:Math.max(0,(Number(childLimit)||0)-usedChildren),
    total:Math.max(0,(Number(adultLimit)||0)-usedAdults)+Math.max(0,(Number(childLimit)||0)-usedChildren)};
 }
 if(!Number.isFinite(limit)||limit<1)return {adults:0,children:0,total:0};
 return {adults:null,children:null,total:Math.max(0,limit-usedAdults-usedChildren)};
}
