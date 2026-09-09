import {test} from 'node:test';
import assert from 'node:assert/strict';
import {solveSketch} from './sketch.js';
test('Solves fixed 30 x 20 mm rectangle from skewed initial guesses',()=>{
 const s=solveSketch({points:[[0,0],[.028,.003],[.032,.018],[.001,.022]],constraints:[{type:'fixed',point:0,at:[0,0]},{type:'horizontal',a:0,b:1},{type:'vertical',a:1,b:2},{type:'horizontal',a:2,b:3},{type:'vertical',a:3,b:0},{type:'distance',a:0,b:1,value:.03},{type:'distance',a:1,b:2,value:.02}]});
 const expected=[[0,0],[.03,0],[.03,.02],[0,.02]];
 s.points.forEach((p,i)=>p.forEach((v,j)=>assert.ok(Math.abs(v-expected[i]![j]!)<1e-8)));
 assert.ok(s.maxResidualMeters<=1e-8);
});
test('Coincident and vertical constraints, free coordinates, degenerate distance start',()=>{
 const s=solveSketch({points:[[0,0],[.02,.01],[.03,.04]],constraints:[{type:'coincident',a:0,b:1},{type:'vertical',a:1,b:2}]});
 assert.ok(Math.hypot(s.points[0]![0]-s.points[1]![0],s.points[0]![1]-s.points[1]![1])<1e-8);
 const d=solveSketch({points:[[0,0],[0,0]],constraints:[{type:'distance',a:0,b:1,value:.02}]});
 assert.ok(Math.abs(d.points[1]![0]-d.points[0]![0]-.02)<1e-8);
});
test('Conflicting constraints and invalid references fail without a solution',()=>{
 assert.throws(()=>solveSketch({points:[[0,0],[1,0]],constraints:[{type:'fixed',point:0,at:[0,0]},{type:'fixed',point:1,at:[1,0]},{type:'distance',a:0,b:1,value:2}]}),/did not converge/);
 assert.throws(()=>solveSketch({points:[[0,0],[1,0]],constraints:[{type:'horizontal',a:0,b:2}]}),/out of range/);
 assert.throws(()=>solveSketch({points:[[0,0],[1,0]],constraints:[{type:'distance',a:0,b:0,value:1}]}),/distinct/);
});
