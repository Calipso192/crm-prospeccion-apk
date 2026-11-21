# Guía de Empaquetado Nativo Android (Capacitor APK)

Documento técnico para envolver la PWA **CRM Prospección v2.0** como aplicación nativa Android sin frameworks ni bundlers, habilitando notificaciones locales con apertura directa de prospectos y despacho externo seguro hacia WhatsApp y Google Calendar.

## 1. Requisitos Previos del Entorno

- Node.js 18 o superior instalado en el entorno de compilación.
- Android Studio o Android SDK Command-Line Tools con Gradle configurado.
- Carpeta raíz del proyecto web limpia (sin archivos temporales ni respaldos sueltos dentro de la ruta web).

## 2. Estructura Web Compatible con Capacitor

Capacitor empaqueta directamente los archivos estáticos de la raíz del proyecto sin necesidad de Webpack ni Vite:

- **index.html**: Punto de entrada único con carga mediante ES Modules nativos.
- **scripts/**: Módulos Vanilla JS desacoplados (servicios y controladores de interfaz).
- **styles/**: Hojas de estilo CSS puras.
- **assets/**: Iconos de aplicación y recursos estáticos.
- **manifest.json** y **sw.js**: Soporte offline y caché local en WebView.

## 3. Inicialización de Capacitor desde Cero

Ejecutar en la raíz del proyecto para crear la configuración base y agregar la plataforma Android:

```bash
npm init -y && npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/local-notifications @capacitor/browser && npx cap init "CRM Prospeccion" "com.crmprospeccion.app" --web-dir . && npx cap add android
```

> **Nota Termux / Android:** En Termux, nunca ejecutes `npm install` ni enlaces simbólicos dentro de `/storage/emulated/0/`. Copia los archivos web estáticos a una carpeta puente dentro del sistema Linux interno (por ejemplo `~/capacitor-builds/crm-prospeccion/www/`) y sincroniza desde ahí o compila mediante GitHub Actions.
