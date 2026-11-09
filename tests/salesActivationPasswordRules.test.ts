import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateActivationPassword } from '../src/utils/salesActivationPasswordRules';

test('password validation retains exact 12–128 length and character class rules',()=>{
 const cases:Array<[string,string|null]>=[
 ['Short!1Aa','A senha deve ter no mínimo 12 caracteres.'],
 ['A'.repeat(129)+'a1!','A senha deve ter no máximo 128 caracteres.'],
 ['lowercase123!abc','Inclua ao menos uma letra maiúscula.'],
 ['UPPERCASE123!ABC','Inclua ao menos uma letra minúscula.'],
 ['PasswordNoDigit!','Inclua ao menos um número.'],
 ['PasswordWith123','Inclua ao menos um símbolo.'],
 ['ValidStrong#Password123',null],
 ];
 for(const [input,expected] of cases)assert.equal(validateActivationPassword(input),expected);
});