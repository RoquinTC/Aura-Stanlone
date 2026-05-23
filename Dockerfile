FROM node:22-bookworm

WORKDIR /app

# Instalamos dependencias globales necesarias
RUN apt-get update && apt-get install -y curl git && rm -rf /var/lib/apt/lists/*

# Copiamos archivos de dependencias
COPY package*.json ./

# Instalamos dependencias
RUN npm install

# Copiamos el resto del código
COPY . .

# Comando para arrancar en modo desarrollo (recarga automática)
CMD ["npm", "run", "dev"]
