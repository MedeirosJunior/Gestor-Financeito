#!/bin/bash
echo "🔨 Iniciando build do Gestor Financeiro..."

echo "📦 Instalando dependências do backend..."
npm install

echo "📂 Navegando para frontend..."
cd gestor-financeiro-frontend

echo "📦 Instalando dependências do frontend..."
npm install

echo "🏗️ Construindo aplicação React..."
npm run build

echo "📁 Verificando se build foi criado..."
if [ -f "build/index.html" ]; then
    echo "✅ Build do frontend criado com sucesso!"
    ls -la build/
else
    echo "❌ Build do frontend falhou!"
    exit 1
fi

echo "🎉 Build completo!"
