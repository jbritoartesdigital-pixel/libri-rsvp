// Age in completed years; 0 = under 1. Invalid values are never coerced to zero.
export function normalizeChildAge(value,personType="child"){
 if(personType!=="child")return null;
 if(value===undefined||value===null||String(value).trim()==="")return null;
 const raw=String(value).trim();
 if(!/^(?:[0-9]|1[0-7])$/.test(raw))return NaN;
 return Number(raw);
}
export function childrenAgeBands(ages){
 const result={"0-2":0,"3-5":0,"6-9":0,"10-12":0,"13-17":0,unknown:0};
 for(const age of ages){
  if(age===null||age===undefined||Number.isNaN(age)){result.unknown++;continue}
  if(age<=2)result["0-2"]++;
  else if(age<=5)result["3-5"]++;
  else if(age<=9)result["6-9"]++;
  else if(age<=12)result["10-12"]++;
  else result["13-17"]++;
 }
 return result;
}
