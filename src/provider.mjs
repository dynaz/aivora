export async function generate(message, request = fetch) {
 if(process.env.AIVORA_AI_MODE !== 'openai')return 'Demo reply: AI integration is ready for configuration.';
 if(!process.env.OPENAI_API_KEY||!process.env.OPENAI_MODEL)throw new Error('AI provider is not configured');
 const response=await request('https://api.openai.com/v1/responses',{method:'POST',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.OPENAI_API_KEY},body:JSON.stringify({model:process.env.OPENAI_MODEL,input:message,max_output_tokens:256,store:false})});
 if(!response.ok)throw new Error('AI provider unavailable');
 const data=await response.json();
 const text=(data.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n');
 if(data.status!=='completed'||!text)throw new Error('AI response incomplete');return text;
}
