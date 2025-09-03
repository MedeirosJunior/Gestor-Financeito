// Configuração da API para diferentes ambientes
const config = {
  development: {
    API_URL: 'http://localhost:3001'
  },
  production: {
    API_URL: process.env.REACT_APP_API_URL || 'https://gestor-financeito-api.onrender.com'
  }
};

const environment = process.env.NODE_ENV || 'development';

export default config[environment];
