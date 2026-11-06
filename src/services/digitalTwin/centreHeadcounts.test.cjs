const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs}=require('../../../scripts/digital-twin/validate.cjs');
const {countCoordinators,countCentreCoordinators}=loadTs('src/services/digitalTwin/centreHeadcounts.ts');
test('coordinators: active, attached by any branch field, national and duplicate records excluded',()=>{
 const docs=[{id:'c1',branchId:'b1',active:true},{id:'c2',assignedBranch:'b1'},{id:'c3',branchIds:['b2','b1'],status:'active'},{id:'c4',branchId:'b1',active:false},{id:'c5',branchId:'b1',isNational:true},{id:'c6',branchId:'b1',nationalCoordinator:true},{id:'c7',branchId:'b2',active:true},{id:'c1',branchId:'b1',active:true},{id:'c8',branchId:'b1',status:'Inactive'}];
 assert.equal(countCoordinators(docs,'b1'),3);assert.equal(countCoordinators(docs,'b2'),2);assert.equal(countCoordinators(docs,'b9'),0);
});
test('centre coordinators: projectadmin role only, active, assigned to the centre; operations users are never counted',()=>{
 const docs=[{id:'u1',role:'projectadmin',assignedBranch:'b1',status:'Active'},{id:'u2',role:'projectadmin',assignedBranch:{id:'b1'}},{id:'u3',role:'projectadmin',branchId:'b1',status:'Inactive'},{id:'u4',role:'operations',assignedBranch:'b1'},{id:'u5',role:'receptionist',assignedBranch:'b1'},{id:'u6',role:'projectadmin',assignedBranch:'b2'},{id:'u7',role:'ProjectAdmin',assignedBranch:'b1',accountDisabledAt:1}];
 assert.equal(countCentreCoordinators(docs,'b1'),2);assert.equal(countCentreCoordinators(docs,'b2'),1);
});
