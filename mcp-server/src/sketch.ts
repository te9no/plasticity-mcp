import {z} from 'zod';
const scalar=z.number().finite(),point=z.tuple([scalar,scalar]),index=z.number().int().nonnegative();
const pair={a:index,b:index};
export const constraintSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('horizontal'),...pair}).strict(),
 z.object({type:z.literal('vertical'),...pair}).strict(),
 z.object({type:z.literal('coincident'),...pair}).strict(),
 z.object({type:z.literal('distance'),...pair,value:scalar.positive()}).strict(),
 z.object({type:z.literal('fixed'),point:index,at:point}).strict(),
]);
export const sketchSchema=z.object({points:z.array(point).min(2).max(64),constraints:z.array(constraintSchema).min(1).max(128)}).strict();
export type Sketch=z.infer<typeof sketchSchema>;
export const sketchProperties={
 points:{type:'array',minItems:2,maxItems:64,items:{type:'array',items:{type:'number'},minItems:2,maxItems:2}},
 constraints:{type:'array',minItems:1,maxItems:128,items:{oneOf:[
  ...['horizontal','vertical','coincident','distance'].map(type=>({type:'object',properties:{type:{const:type},a:{type:'integer',minimum:0},b:{type:'integer',minimum:0},...(type==='distance'?{value:{type:'number',exclusiveMinimum:0}}:{})},required:type==='distance'?['type','a','b','value']:['type','a','b'],additionalProperties:false})),
  {type:'object',properties:{type:{const:'fixed'},point:{type:'integer',minimum:0},at:{type:'array',items:{type:'number'},minItems:2,maxItems:2}},required:['type','point','at'],additionalProperties:false},
 ]}},
};

// Damped least squares in meters. Free dimensions stay near the supplied initial guess.
// Success means residuals meet tolerance, never that a sketch is fully constrained.
export function solveSketch(raw:unknown){
 const input=sketchSchema.parse(raw),n=input.points.length*2;
 for(const c of input.constraints){
  const refs=c.type==='fixed'?[c.point]:[c.a,c.b];
  if(refs.some(i=>i>=input.points.length))throw new Error('Constraint point index out of range');
  if(c.type!=='fixed'&&c.a===c.b)throw new Error('Constraint requires distinct point indices');
 }
 let x=input.points.flat(),lambda=1e-4;
 const tolerance=1e-8;
 function evaluate(v:number[]){
  const residuals:number[]=[],jac:number[][]=[];
  const row=(r:number,entries:[number,number][])=>{const a=Array(n).fill(0);for(const [i,k] of entries)a[i]+=k;residuals.push(r);jac.push(a)};
  for(const c of input.constraints){
   if(c.type==='fixed'){row(v[c.point*2]!-c.at[0],[[c.point*2,1]]);row(v[c.point*2+1]!-c.at[1],[[c.point*2+1,1]]);continue}
   const a=c.a*2,b=c.b*2,dx=v[b]!-v[a]!,dy=v[b+1]!-v[a+1]!;
   if(c.type==='vertical'||c.type==='coincident')row(dx,[[a,-1],[b,1]]);
   if(c.type==='horizontal'||c.type==='coincident')row(dy,[[a+1,-1],[b+1,1]]);
   if(c.type==='distance'){
    const length=Math.hypot(dx,dy);
    // Choose a deterministic initial direction for coincident initial guesses.
    const ux=length>1e-15?dx/length:1,uy=length>1e-15?dy/length:0;
    row(length-c.value,[[a,-ux],[b,ux],[a+1,-uy],[b+1,uy]]);
   }
  }
  return {residuals,jac,cost:residuals.reduce((s,r)=>s+r*r,0),max:Math.max(...residuals.map(Math.abs))};
 }
 for(let iteration=0;iteration<250;iteration++){
  const current=evaluate(x);
  if(current.max<=tolerance)return {points:input.points.map((_,i)=>[x[2*i]!,x[2*i+1]!] as [number,number]),constraints:input.constraints,maxResidualMeters:current.max,toleranceMeters:tolerance,iterations:iteration,status:'satisfied' as const,persistence:'Recipe only; no live constraints are installed in Plasticity.'};
  const matrix=Array.from({length:n},(_,i)=>Array.from({length:n+1},(_,j)=>i===j?lambda:0));
  for(let k=0;k<current.jac.length;k++){const row=current.jac[k]!;for(let i=0;i<n;i++){matrix[i]![n]!-=row[i]!*current.residuals[k]!;for(let j=0;j<n;j++)matrix[i]![j]!+=row[i]!*row[j]!}}
  for(let k=0;k<n;k++){
   let pivot=k;for(let i=k+1;i<n;i++)if(Math.abs(matrix[i]![k]!)>Math.abs(matrix[pivot]![k]!))pivot=i;
   [matrix[k],matrix[pivot]]=[matrix[pivot]!,matrix[k]!];
   const d=matrix[k]![k]!;if(Math.abs(d)<1e-20)throw new Error('Constraint solver became singular');
   for(let j=k;j<=n;j++)matrix[k]![j]!/=d;
   for(let i=k+1;i<n;i++){const factor=matrix[i]![k]!;for(let j=k;j<=n;j++)matrix[i]![j]!-=factor*matrix[k]![j]!}
  }
  const delta=Array(n).fill(0);for(let i=n-1;i>=0;i--){delta[i]=matrix[i]![n]!;for(let j=i+1;j<n;j++)delta[i]-=matrix[i]![j]!*delta[j]}
  const candidate=x.map((v,i)=>v+delta[i]);
  if(candidate.every(Number.isFinite)&&evaluate(candidate).cost<current.cost){x=candidate;lambda=Math.max(1e-12,lambda/3)}else lambda=Math.min(1e12,lambda*10);
 }
 throw new Error(`Constraints did not converge (max residual ${evaluate(x).max} m). Conflicting constraints or a poor initial guess; no geometry created.`);
}
