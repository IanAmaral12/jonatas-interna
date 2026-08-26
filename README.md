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

- Login com e-mail e senha para usuários criados pelo administrador
- Recuperação e atualização de senha
- Persistência e observação da sessão
- Encerramento de sessão
- Mensagens de erro em português
- Layout responsivo e acessível

## Banco de dados

As alterações do banco ficam versionadas em `supabase/migrations`. A migração inicial cria a tabela `public.orders` para receber pedidos de plataformas externas. O campo `id` é textual e deve receber o identificador enviado pelo webhook.

A tabela utiliza Row Level Security sem políticas públicas por padrão. Integrações de backend podem gravar com uma chave de servidor; políticas de leitura para usuários autenticados devem ser adicionadas conforme as regras de acesso do dashboard.
