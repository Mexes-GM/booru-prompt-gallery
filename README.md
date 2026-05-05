
# Booru Prompt Gallery

Una galería de imágenes para navegar y obtener prompts de Danbooru, Rule34 y Aibooru. Diseñada para artistas y entusiastas de la generación de imágenes por IA.

[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com/mexecution3-1312s-projects/v0-app-for-image-prompts)

## Características

*   **Multi-proveedor:** Soporte para Danbooru, Aibooru y Rule34.
*   **Limpieza de Prompts:** Algoritmos avanzados para extraer y limpiar tags, eliminando metadatos innecesarios y optimizando para Stable Diffusion.
*   **Búsqueda Avanzada:** Filtrado por tags, clasificación (popular, reciente, aleatorio) y soporte para metadatos de IA.
*   **Descargas Optimizadas:** Proxy de descarga con streaming para evitar problemas de CORS y reducir el consumo de memoria.

## Arquitectura y Mejoras Recientes

Este proyecto ha sido optimizado para rendimiento y escalabilidad:

### 1. Backend Modular
Se ha implementado una arquitectura basada en el patrón **Factory** y **Strategy**:
*   `lib/booru/`: Contiene la lógica central.
    *   `providers/`: Implementaciones específicas para cada servicio (Danbooru, Rule34, Aibooru).
    *   `factory.ts`: Instancia el proveedor correcto según la petición.
    *   `base.ts`: Clase abstracta que maneja la lógica común (fetch, normalización).

### 2. Gestión de Red Robusta (`SmartFetch`)
El cliente HTTP interno (`lib/network/smart-fetch.ts`) incluye:
*   **Reintentos Automáticos:** Con "Exponential Backoff" para manejar fallos transitorios.
*   **Manejo de Rate Limits:** Detecta headers `Retry-After` (429) y espera inteligentemente.
*   **Timeouts:** Protección contra peticiones colgadas.

### 3. Descargas Eficientes (Streaming)
El endpoint `api/download` utiliza **Web Streams** para canalizar los datos desde el origen al cliente sin cargar el archivo completo en la memoria del servidor. Esto permite manejar archivos grandes con un uso de RAM cercano a cero.

## Configuración Local

1.  Clonar el repositorio.
2.  Instalar dependencias:
    ```bash
    npm install
    ```
3.  Configurar variables de entorno (opcional para Rule34):
    ```env
    RULE34_API_KEY=tu_api_key
    RULE34_USER_ID=tu_user_id
    ```
4.  Iniciar el servidor de desarrollo:
    ```bash
    npm run dev
    ```

## Tecnologías

*   **Framework:** Next.js 14 (App Router)
*   **Runtime:** Edge Runtime
*   **Styling:** Tailwind CSS + Shadcn/UI
*   **Data Fetching:** SWR

## Licencia

MIT
