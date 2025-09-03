# Configuração do Frontend para Deploy Separado

## 🚀 Deploy do Frontend no Netlify

### 1. Criar conta no Netlify
- Acesse: https://netlify.com
- Conecte com GitHub

### 2. Configurar Deploy
- **Repository**: MedeirosJunior/Gestor-Financeito
- **Branch**: main
- **Base directory**: gestor-financeiro-frontend
- **Build command**: npm run build
- **Publish directory**: build

### 3. Environment Variables no Netlify
```
REACT_APP_API_URL=https://gestor-financeito-api.onrender.com
```

### 4. Configurações de Build
- **Node version**: 18.18.0
- **Build timeout**: 15 minutes

## 🔧 Alternativa: Vercel

### Deploy Settings
- **Framework**: Create React App
- **Root Directory**: gestor-financeiro-frontend
- **Build Command**: npm run build
- **Output Directory**: build

### Environment Variables
```
REACT_APP_API_URL=https://gestor-financeito-api.onrender.com
```

## 📱 URLs Finais
- **Frontend**: https://gestor-financeito.netlify.app
- **Backend API**: https://gestor-financeito-api.onrender.com
- **Health Check**: https://gestor-financeito-api.onrender.com/api/health
