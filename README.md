# Nutra X1 — Autenticação com Supabase

Tela de autenticação em React, Vite e Supabase Auth, inteiramente em português.

## Configuração

1. No painel do Supabase, abra **Project Settings > API**.
2. Preencha o arquivo `.env`:

```env
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=SUA_CHAVE_PUBLICA
```

3. Em **Authentication > URL Configuration**, adicione a URL local `http://localhost:5173` em **Redirect URLs**.

## Executar

```bash
npm install
npm run dev
```

## Recursos incluídos

- Login e cadastro com e-mail e senha
- Confirmação de cadastro por e-mail
- Recuperação e atualização de senha
- Persistência e observação da sessão
- Encerramento de sessão
- Mensagens de erro em português
- Layout responsivo e acessível
