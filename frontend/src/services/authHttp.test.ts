import {beforeEach,expect,it,vi} from 'vitest';
import {AuthHttpError,getAuthJsonHeaders} from './authHttp';
const state=vi.hoisted(()=>({uid:'alice' as string|null,token:vi.fn()}));
vi.mock('../firebase',()=>({auth:{get currentUser(){return state.uid?{uid:state.uid,getIdToken:state.token}:null;}}}));
beforeEach(()=>{state.uid='alice';state.token.mockReset().mockResolvedValue('synthetic.jwt');});
it('returns authenticated headers for the captured actor and refuses missing or mismatched actors before obtaining a token',async()=>{
  expect(await getAuthJsonHeaders('alice')).toEqual({'Content-Type':'application/json',Authorization:'Bearer synthetic.jwt'});
  state.token.mockClear();await expect(getAuthJsonHeaders('bob')).rejects.toBeInstanceOf(AuthHttpError);expect(state.token).not.toHaveBeenCalled();
  state.uid=null;await expect(getAuthJsonHeaders()).rejects.toBeInstanceOf(AuthHttpError);expect(state.token).not.toHaveBeenCalled();
});
it('token errors and malformed tokens fail without anonymous headers or raw diagnostics',async()=>{
  const warn=vi.spyOn(console,'warn');
  for(const value of ['', 'synthetic\nprivate-token']){state.token.mockResolvedValueOnce(value);await expect(getAuthJsonHeaders('alice')).rejects.toBeInstanceOf(AuthHttpError);}
  state.token.mockRejectedValueOnce(Error('SYNTHETIC_PRIVATE_DIAGNOSTIC'));await expect(getAuthJsonHeaders('alice')).rejects.toThrow('sessão autenticada');expect(warn).not.toHaveBeenCalled();warn.mockRestore();
});
it('an account change during token acquisition prevents returning the old credential',async()=>{
  state.token.mockImplementationOnce(async()=>{state.uid='bob';return'synthetic.jwt';});await expect(getAuthJsonHeaders('alice')).rejects.toBeInstanceOf(AuthHttpError);
});
