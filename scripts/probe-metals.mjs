// Public supply-chain probe, GitHub runner only. Never prints credentials or full URLs.
// Gold API: indicative USD spot (gold/silver in oz, copper HG in lb).
// FRED: IMF nickel monthly USD per metric ton. Not intraday prices.
const targets=[
  ['gold','https://api.gold-api.com/price/XAU'],
  ['silver','https://api.gold-api.com/price/XAG'],
  ['copper','https://api.gold-api.com/price/HG'],
  ['nickel','https://fred.stlouisfed.org/graph/fredgraph.csv?id=PNICKUSDM&cosd=2026-01-01'],
];
await Promise.all(targets.map(async ([name,url])=>{
  try {
    const response=await fetch(url,{signal:AbortSignal.timeout(8000),headers:{Accept:name==='nickel'?'text/csv':'application/json'}});
    if(!response.ok){console.log('METAL_PROBE',JSON.stringify({name,status:'http_'+response.status}));return;}
    if(name==='nickel'){
      const text=await response.text();const rows=text.trim().split(/\r?\n/);const last=rows.filter(row=>/^(20\d{2})-\d{2}-\d{2},[0-9.]+$/.test(row)).at(-1);
      console.log('METAL_PROBE',JSON.stringify({name,status:last?'valid_monthly_csv':'invalid_csv',header:rows[0]?.slice(0,80),lastObservation:last?.split(',')[0]||null,unit:'USD/metric-ton monthly'}));
    } else {
      const data=await response.json();
      console.log('METAL_PROBE',JSON.stringify({name,status:data&&Number.isFinite(Number(data.price))?'valid_json':'invalid_json',symbol:data?.symbol,price:Number(data?.price),currency:data?.currency,updatedAt:data?.updatedAt,keys:Object.keys(data||{}).slice(0,20)}));
    }
  }catch(e){console.log('METAL_PROBE',JSON.stringify({name,status:'request_failed',type:e?.name||'error'}));}
}));
