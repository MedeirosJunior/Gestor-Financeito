// Configuração da API para diferentes ambientes
const config = {
  development: {
    API_URL: 'https://gestor-financeito.onrender.com', // Usar API do Render em desenvolvimento também
    ALLOW_OFFLINE: true // Permite modo offline em desenvolvimento
  },
  production: {
    API_URL: process.env.REACT_APP_API_URL || 'https://gestor-financeito.onrender.com',
    ALLOW_OFFLINE: false // Força conexão com servidor em produção
  }
};

const environment = process.env.NODE_ENV || 'development';

export default config[environment];
