import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, expect, vi } from 'vitest';
import { Service } from './service';
vi.mock('node:child_process', async importOriginal => {
 const original = await importOriginal<typeof import('node:child_process')>();
 return {...original, execFile: vi.fn((_cmd, _args, _opts, callback) => { setTimeout(() => callback(null), 20); })};
});
import { execFile } from 'node:child_process';
it('persistent poll single flight, stopped skip, new instance resumes, missing config does nothing', async () => {
 const root=await mkdtemp(join(tmpdir(),'wf111-poll-')); const prior=process.env.PASEO_HOME; process.env.PASEO_HOME=root;
 try {
  const subject:any=new Service({} as any);
  await subject.pollProgramHandover(); expect(execFile).not.toHaveBeenCalled();
  await mkdir(join(root,'zerosub'),{recursive:true});
  await writeFile(join(root,'zerosub/commander-handover.json'),JSON.stringify({programCommand:'/fake/program-handover'}));
  await Promise.all([subject.pollProgramHandover(),subject.pollProgramHandover()]);
  expect(execFile).toHaveBeenCalledTimes(1); expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual(['--poll']);
  subject.stopped=true; await subject.pollProgramHandover(); expect(execFile).toHaveBeenCalledTimes(1);
  await (new Service({} as any) as any).pollProgramHandover(); expect(execFile).toHaveBeenCalledTimes(2);
 } finally { if(prior===undefined) delete process.env.PASEO_HOME;else process.env.PASEO_HOME=prior; await rm(root,{recursive:true,force:true}); }
});
