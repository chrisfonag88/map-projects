// ====================================
// CONFIGURACIÓN DE FIREBASE
// ====================================

// Obtener referencia a Firestore
const db = firebase.firestore();
const auth = firebase.auth();
// Colección de proyectos
const projectsCollection = db.collection('projects');

// ====================================
// VARIABLES GLOBALES
// ====================================

// Mapa y marcadores
let map;
let tempMarker = null;
let tempLocation = null;
let markers = [];

// Datos
let projects = [];
let currentFilter = 'all';
let searchTerm = '';

// Estado de conexión
let isOnline = false;
let currentUser = null; 
let isAdmin = false;
// Colores para categorías
const categoryColors = {
    'Reciclaje y manejo de residuos': '#4CAF50',
    'Huerto escolar o agricultura sostenible': '#8BC34A',
    'Proyecto pecuario sostenible': '#795548',
    'Educación, comunicación y/o sensibilización ambiental': '#2196F3',
    'Conservación de recursos naturales': '#009688',
    'Tecnología para la sostenibilidad': '#9C27B0',
    'Infraestructura ecológica': '#FF9800',
    'Proyecto comunitario o de participación ciudadana': '#3F51B5',
    'Emprendimiento o economía circular': '#00BCD4',
    'Salud y bienestar': '#F44336',
    'Agua y saneamiento': '#03A9F4',
    'Cambio climático y mitigación': '#FFC107',
    'Otra': '#607D8B'
};

// ====================================
// FUNCIONES DE UTILIDAD
// ====================================

// Mostrar toast de notificación
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Actualizar estado de conexión
function updateConnectionStatus(status) {
    const statusElement = document.getElementById('connection-status');
    const statusDot = statusElement.querySelector('.status-dot');
    const statusText = document.getElementById('status-text');
    
    statusDot.className = 'status-dot';
    
    switch(status) {
        case 'online':
            statusDot.classList.add('status-online');
            statusText.textContent = 'En línea';
            isOnline = true;
            break;
        case 'offline':
            statusDot.classList.add('status-offline');
            statusText.textContent = 'Sin conexión';
            isOnline = false;
            break;
        case 'syncing':
            statusDot.classList.add('status-syncing');
            statusText.textContent = 'Sincronizando...';
            break;
    }
}

// Ocultar loading
function hideLoading() {
    document.getElementById('loading').classList.add('hidden');
}

// Formatear fecha
function formatDate(timestamp) {
    const date = timestamp instanceof Date ? timestamp : timestamp.toDate();
    return date.toLocaleDateString('es-EC', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Crear icono personalizado
function createColoredIcon(color, isPulsing = false) {
    const pulseStyle = isPulsing ? 'animation: pulse 2s infinite;' : '';
    const svg = `
        <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 42' 
             style='width: 32px; height: 42px; filter: drop-shadow(2px 4px 6px rgba(0,0,0,0.3)); ${pulseStyle}'>
            <path fill='${color}' stroke='white' stroke-width='2' 
                  d='M16 1C7.7 1 1 7.7 1 16c0 11.2 15 25 15 25s15-13.8 15-25C31 7.7 24.3 1 16 1z'/>
            <circle cx='16' cy='16' r='6' fill='white'/>
        </svg>`;
    
    return new L.DivIcon({
        className: 'custom-icon',
        html: svg,
        iconSize: [32, 42],
        iconAnchor: [16, 42],
        popupAnchor: [0, -42]
    });
}

// ====================================
// FUNCIONES DE FIREBASE
// ====================================

// Cargar proyectos desde Firebase
async function loadProjects() {
    try {
        updateConnectionStatus('syncing');
        
        const snapshot = await projectsCollection.orderBy('createdAt', 'desc').get();
        projects = [];
        
        snapshot.forEach(doc => {
            projects.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        console.log(`Cargados ${projects.length} proyectos desde Firebase`);
        updateConnectionStatus('online');
        
        // Renderizar proyectos en el mapa y la lista
        renderAllProjects();
        
    } catch (error) {
        console.error('Error al cargar proyectos:', error);
        updateConnectionStatus('offline');
        showToast('Error al cargar proyectos', 'error');
    }
}

// Escuchar cambios en tiempo real
function listenToProjects() {
    projectsCollection.onSnapshot(
        (snapshot) => {
            const changes = snapshot.docChanges();
            
            changes.forEach(change => {
                const projectData = {
                    id: change.doc.id,
                    ...change.doc.data()
                };
                
                if (change.type === 'added') {
                    // Verificar si el proyecto ya existe localmente
                    const exists = projects.find(p => p.id === projectData.id);
                    if (!exists) {
                        projects.unshift(projectData);
                        addMarkerToMap(projectData);
                        showToast('Nuevo proyecto añadido', 'success');
                    }
                } else if (change.type === 'removed') {
                    const index = projects.findIndex(p => p.id === projectData.id);
                    if (index !== -1) {
                        projects.splice(index, 1);
                        removeMarkerFromMap(projectData.id);
                        showToast('Proyecto eliminado', 'warning');
                    }
                } else if (change.type === 'modified') {
                    const index = projects.findIndex(p => p.id === projectData.id);
                    if (index !== -1) {
                        projects[index] = projectData;
                        updateMarkerOnMap(projectData);
                    }
                }
            });
            
            updateStats();
            createFilterButtons();
            renderProjects();
            updateConnectionStatus('online');
        },
        (error) => {
            console.error('Error en listener:', error);
            updateConnectionStatus('offline');
        }
    );
}

// Guardar proyecto en Firebase
async function saveProject(projectData) {
    try {
        updateConnectionStatus('syncing');
        
        const docRef = await projectsCollection.add({
            ...projectData,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        console.log('Proyecto guardado con ID:', docRef.id);
        updateConnectionStatus('online');
        return docRef.id;
        
    } catch (error) {
        console.error('Error al guardar proyecto:', error);
        updateConnectionStatus('offline');
        showToast('Error al guardar proyecto', 'error');
        throw error;
    }
}

// Eliminar proyecto de Firebase
async function deleteProjectFromFirebase(projectId) {
    try {
        updateConnectionStatus('syncing');
        await projectsCollection.doc(projectId).delete();
        console.log('Proyecto eliminado:', projectId);
        updateConnectionStatus('online');
    } catch (error) {
        console.error('Error al eliminar proyecto:', error);
        updateConnectionStatus('offline');
        showToast('Error al eliminar proyecto', 'error');
        throw error;
    }
}

// ====================================
// FUNCIONES DE MAPA
// ====================================

// Inicializar mapa
function initializeMap() {
    map = L.map('map',
        { zoomControl: false }
    ).setView([-1.8312, -78.1834], 7);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // Variables para controlar el arrastre
    let isDragging = false;
    let dragTimeout;

    // Detectar cuando empieza el arrastre
    map.on('dragstart', function() {
        isDragging = true;
    });

    // Detectar cuando termina el arrastre
    map.on('dragend', function() {
        // Esperar un momento antes de permitir clicks nuevamente
        setTimeout(() => {
            isDragging = false;
        }, 100);
    });

    // Evento de clic en el mapa - SOLO si no está arrastrando
    map.on('click', function(e) {
        // Ignorar el click si estamos arrastrando el mapa
        if (isDragging) {
            return;
        }
        
        // Verificar que el click no sea sobre un control o botón
        if (e.originalEvent.target.closest('.leaflet-control') || 
            e.originalEvent.target.closest('button')) {
            return;
        }
        
        // Remover marcador temporal anterior si existe
        if (tempMarker) {
            map.removeLayer(tempMarker);
        }
        
        // Crear nuevo marcador temporal
        tempLocation = e.latlng;
        tempMarker = L.marker(tempLocation, { 
            icon: createColoredIcon('#FF5722', true) 
        }).addTo(map);
        
        // Actualizar estado de ubicación
        updateLocationStatus(true);
        
        // Opcional: Mostrar confirmación visual
        showToast('📍 Ubicación seleccionada', 'success');
    });

    // Prevenir la selección de marcadores al hacer click derecho
    map.on('contextmenu', function(e) {
        // No hacer nada en click derecho
        return false;
    });
}

// Actualizar estado de ubicación
function updateLocationStatus(selected) {
    const status = document.getElementById('location-status');
    if (selected) {
        status.className = 'location-status location-selected';
        status.innerHTML = '<i class="fas fa-check-circle"></i> Ubicación seleccionada';
    } else {
        status.className = 'location-status location-pending';
        status.innerHTML = '<i class="fas fa-map-pin"></i> Haz clic en el mapa para seleccionar ubicación';
    }
}

// Añadir marcador al mapa
function addMarkerToMap(project) {
    const color = categoryColors[project.category] || categoryColors['Otro'];
    const marker = L.marker([project.lat, project.lng], { 
        icon: createColoredIcon(color) 
    }).addTo(map);
    
    const popupContent = `
        <div style="min-width: 250px; max-width: 350px;">
            <h3 style="margin: 0 0 10px 0; color: ${color};">${project.name}</h3>
            <p style="margin: 5px 0; font-size: 0.9em;">
                <strong>Institución:</strong> ${project.institution}
            </p>
            ${project.amieCode ? `
            <p style="margin: 5px 0; font-size: 0.85em; color: #666;">
                <strong> Código AMIE:</strong> ${project.amieCode}
            </p>` : ''}
            <p style="margin: 5px 0; font-size: 0.9em;">
                <strong>Categoría:</strong> ${project.category}
            </p>
            <p style="margin: 10px 0; font-size: 0.9em;">
                <strong>Descripción:</strong> ${project.description}
            </p>
            ${project.resultsImpacts ? `
            <p style="margin: 10px 0; font-size: 0.9em; border-top: 1px solid #eee; padding-top: 10px;">
                <strong>Resultados e Impactos:</strong> ${project.resultsImpacts}
            </p>` : ''}
            ${project.supportingInstitutions ? `
            <p style="margin: 10px 0; font-size: 0.9em; border-top: 1px solid #eee; padding-top: 10px;">
                <strong>Instituciones de apoyo:</strong> ${project.supportingInstitutions}
            </p>` : ''}
            ${project.potentialCollaborators ? `
            <p style="margin: 10px 0; font-size: 0.9em;">
                <strong>Potenciales colaboradores:</strong> ${project.potentialCollaborators}
            </p>` : ''}
            <p style="margin: 5px 0; font-size: 0.8em; color: #666;">
                <i class="fas fa-calendar"></i> ${project.createdAt ? formatDate(project.createdAt) : 'Recién añadido'}
            </p>
        </div>
    `;
    
    marker.bindPopup(popupContent);
    marker.projectId = project.id;
    markers.push(marker);
    
    return marker;
}

// Remover marcador del mapa
function removeMarkerFromMap(projectId) {
    const markerIndex = markers.findIndex(m => m.projectId === projectId);
    if (markerIndex !== -1) {
        map.removeLayer(markers[markerIndex]);
        markers.splice(markerIndex, 1);
    }
}

// Actualizar marcador en el mapa
function updateMarkerOnMap(project) {
    removeMarkerFromMap(project.id);
    addMarkerToMap(project);
}

// Limpiar todos los marcadores
function clearMarkers() {
    markers.forEach(marker => map.removeLayer(marker));
    markers = [];
}

// Función para limpiar la selección de ubicación
function clearLocationSelection() {
    if (tempMarker) {
        map.removeLayer(tempMarker);
        tempMarker = null;
        tempLocation = null;
        updateLocationStatus(false);
        
        // Ocultar botón de limpiar
        document.getElementById('clear-location-btn').style.display = 'none';
        
        showToast('Ubicación eliminada', 'info');
    }
}

// Modificar la función updateLocationStatus para mostrar/ocultar el botón
function updateLocationStatus(selected) {
    const status = document.getElementById('location-status');
    const clearBtn = document.getElementById('clear-location-btn');
    
    if (selected) {
        status.className = 'location-status location-selected';
        status.innerHTML = '<i class="fas fa-check-circle"></i> Ubicación seleccionada';
        // Mostrar botón de limpiar
        if (clearBtn) clearBtn.style.display = 'block';
    } else {
        status.className = 'location-status location-pending';
        status.innerHTML = '<i class="fas fa-map-pin"></i> Haz clic en el mapa para seleccionar ubicación';
        // Ocultar botón de limpiar
        if (clearBtn) clearBtn.style.display = 'none';
    }
}

// Hacer la función global
window.clearLocationSelection = clearLocationSelection;

// ====================================
// FUNCIONES DE CONTROL DEL MAPA
// ====================================

// Coordenadas y zoom inicial de Ecuador
const ECUADOR_CENTER = {
    lat: -1.8312,
    lng: -78.1834,
    zoom: 7
};

// Función para resetear/centrar el mapa
function resetMap() {
    // Animar el mapa de vuelta al centro de Ecuador
    map.setView([ECUADOR_CENTER.lat, ECUADOR_CENTER.lng], ECUADOR_CENTER.zoom, {
        animate: true,
        duration: 1
    });
    
}

// Función para hacer zoom in
function zoomIn() {
    map.zoomIn();
}

// Función para hacer zoom out
function zoomOut() {
    map.zoomOut();
}

// Función adicional para centrar en todos los proyectos
function fitAllProjects() {
    if (markers.length > 0) {
        const group = new L.featureGroup(markers);
        map.fitBounds(group.getBounds().pad(0.1), {
            animate: true,
            duration: 1
        });
        showToast('Vista ajustada a todos los proyectos', 'success');
    } else {
        resetMap();
    }
}


// ====================================
// FUNCIONES DE INTERFAZ
// ====================================

// Actualizar estadísticas
function updateStats() {
    document.getElementById('total-projects').textContent = projects.length;
    
    const institutions = new Set(projects.map(p => p.institution));
    document.getElementById('total-institutions').textContent = institutions.size;
    
    const categories = new Set(projects.map(p => p.category));
    document.getElementById('total-categories').textContent = categories.size;
}

// Crear botones de filtro
function createFilterButtons() {
    const categories = ['all', ...new Set(projects.map(p => p.category))];
    const container = document.getElementById('filter-buttons');
    
    container.innerHTML = '';
    
    categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = `filter-btn ${cat === currentFilter ? 'active' : ''}`;
        btn.dataset.filter = cat;
        btn.textContent = cat === 'all' ? 'Todos' : cat;
        btn.onclick = () => filterProjects(cat);
        container.appendChild(btn);
    });
}

// Filtrar proyectos
function filterProjects(category) {
    currentFilter = category;
    
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === category);
    });
    
    renderProjects();
}

// Renderizar proyectos en la lista
function renderProjects() {
    const container = document.getElementById('projects-container');
    
    let filtered = projects;
    
    if (currentFilter !== 'all') {
        filtered = filtered.filter(p => p.category === currentFilter);
    }
    
    if (searchTerm) {
        filtered = filtered.filter(p => 
            p.name.toLowerCase().includes(searchTerm) ||
            p.institution.toLowerCase().includes(searchTerm) ||
            p.description.toLowerCase().includes(searchTerm)
        );
    }
    
    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-search"></i>
                <p>No se encontraron proyectos</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = filtered.map(project => {
        const color = categoryColors[project.category] || categoryColors['Otra'];
        
        // Truncar texto largo para la vista de lista
        const truncateText = (text, maxLength = 150) => {
            if (!text) return '';
            return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
        };
    const deleteButton = isAdmin ? `
            <button class="delete-btn" onclick="deleteProject('${project.id}')" style="display: inline-block;">
                <i class="fas fa-trash"></i> Eliminar
            </button>
        ` : '';
        
        return `
            <div class="project-item" data-id="${project.id}">
                <div class="project-header">
                    <span class="project-title">${project.name}</span>
                    ${deleteButton}
                </div>
                <div class="project-institution">
                    <i class="fas fa-building"></i> ${project.institution}
                </div>
                <div class="project-description">${truncateText(project.description)}</div>
                ${project.supportingInstitutions ? `
                <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e0e0e0;">
                    <small style="color: #666;">
                        <strong>Apoyo:</strong> ${truncateText(project.supportingInstitutions, 100)}
                    </small>
                </div>` : ''}
                <div class="project-meta">
                    <span class="project-category" style="background: ${color}20; color: ${color};">
                        ${project.category}
                    </span>
                    <span class="project-date">
                        ${project.createdAt ? formatDate(project.createdAt) : 'Recién añadido'}
                    </span>
                </div>
            </div>
        `;
    }).join('');    
    
    // Añadir eventos de hover
    container.querySelectorAll('.project-item').forEach(item => {
        item.addEventListener('mouseenter', () => {
            const id = item.dataset.id;
            const marker = markers.find(m => m.projectId === id);
            if (marker) {
                marker.openPopup();
                map.panTo(marker.getLatLng());
            }
        });
    });
}

// Renderizar todos los proyectos
function renderAllProjects() {
    clearMarkers();
    projects.forEach(project => addMarkerToMap(project));
    updateStats();
    createFilterButtons();
    renderProjects();
}

// ====================================
// FUNCIONES CRUD
// ====================================

// Añadir proyecto
async function addProject(e) {
    e.preventDefault();
    
    if (!tempLocation) {
        showToast('Por favor, selecciona una ubicación en el mapa', 'warning');
        return;
    }
    
    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Guardando...</span>';
    
    const projectData = {
        institution: document.getElementById('institution').value.trim(),
        amieCode: document.getElementById('amie-code').value.trim(),
        name: document.getElementById('project-name').value.trim(),
        category: document.getElementById('category').value,
        description: document.getElementById('description').value.trim(),
        supportingInstitutions: document.getElementById('supporting-institutions').value.trim(),
        potentialCollaborators: document.getElementById('potential-collaborators').value.trim(),
        resultsImpacts: document.getElementById('results-impacts').value.trim(),
        lat: tempLocation.lat,
        lng: tempLocation.lng
    };
    
    try {
        await saveProject(projectData);
        
        // Limpiar formulario
        document.getElementById('project-form').reset();
        
        // Limpiar marcador temporal
        if (tempMarker) {
            map.removeLayer(tempMarker);
            tempMarker = null;
            tempLocation = null;
        }
        
        updateLocationStatus(false);
        showToast('Proyecto guardado exitosamente', 'success');
        
    } catch (error) {
        showToast('Error al guardar el proyecto', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-save"></i> <span>Guardar Proyecto</span>';
    }
}

// Eliminar proyecto
async function deleteProject(id) {
    if (!isAdmin) {
        showToast('Solo los administradores pueden eliminar proyectos', 'error');
        return;
    }
    
    if (!confirm('¿Estás seguro de eliminar este proyecto?')) {
        return;
    }
    
    try {
        await deleteProjectFromFirebase(id);
        showToast('Proyecto eliminado', 'success');
    } catch (error) {
        showToast('Error al eliminar el proyecto', 'error');
    }
}

// ====================================
// FUNCIONES DE EXPORTACIÓN
// ====================================


// Exportar a Excel
function exportToExcel() {
    if (projects.length === 0) {
        showToast('No hay proyectos para exportar', 'warning');
        return;
    }
    
    // Preparar datos para Excel con formato legible
    const excelData = projects.map((p, index) => ({
        'No.': index + 1,
        'Institución': p.institution || '',
        'Código AMIE': p.amieCode || 'No especificado',
        'Nombre del Proyecto': p.name || '',
        'Categoría': p.category || '',
        'Descripción': p.description || '',
        'Resultados e Impactos': p.resultsImpacts || 'No especificado',
        'Instituciones que Apoyan': p.supportingInstitutions || 'No especificado',
        'Potenciales Colaboradores': p.potentialCollaborators || 'No especificado',
        'Latitud': p.lat ? p.lat.toFixed(6) : '',
        'Longitud': p.lng ? p.lng.toFixed(6) : '',
        'Fecha de Registro': p.createdAt ? formatDate(p.createdAt) : new Date().toLocaleDateString('es-EC')
    }));
    
    // Crear libro de Excel
    const wb = XLSX.utils.book_new();
    
    // Crear hoja de proyectos
    const ws = XLSX.utils.json_to_sheet(excelData);
    
    // Ajustar anchos de columna
    const columnWidths = [
        { wch: 5 },   // No.
        { wch: 30 },  // Institución
        { wch: 15 },  // ⭐ Código AMIE
        { wch: 35 },  // Nombre del Proyecto
        { wch: 30 },  // Categoría
        { wch: 50 },  // Descripción
        { wch: 40 },  // Instituciones que Apoyan
        { wch: 40 },  // Potenciales Colaboradores
        { wch: 50 },  // ⭐ Resultados e Impactos
        { wch: 12 },  // Latitud
        { wch: 12 },  // Longitud
        { wch: 20 }   // Fecha de Registro
    ];
    ws['!cols'] = columnWidths;
    
    // Añadir la hoja al libro
    XLSX.utils.book_append_sheet(wb, ws, 'Proyectos');
    
    // Crear hoja de resumen
    const summaryData = createSummaryData();
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    wsSummary['!cols'] = [{ wch: 30 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen');
    
    // Crear hoja de estadísticas por categoría
    const statsData = createCategoryStats();
    const wsStats = XLSX.utils.json_to_sheet(statsData);
    wsStats['!cols'] = [{ wch: 40 }, { wch: 15 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, wsStats, 'Estadísticas');
    
    // Generar archivo
    const fileName = `proyectos_fonag_ecuador_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
    
    showToast('Excel exportado exitosamente', 'success');
}

// Crear estadísticas por categoría
function createCategoryStats() {
    const categoryCount = {};
    projects.forEach(p => {
        categoryCount[p.category] = (categoryCount[p.category] || 0) + 1;
    });
    
    return Object.entries(categoryCount)
        .sort((a, b) => b[1] - a[1])
        .map(([category, count]) => ({
            'Categoría': category,
            'Cantidad': count,
            'Porcentaje': ((count / projects.length) * 100).toFixed(1) + '%'
        }));
}

// Crear datos de resumen para Excel
function createSummaryData() {
    const institutions = new Set(projects.map(p => p.institution));
    const categories = new Set(projects.map(p => p.category));
    
    return [
        { 'Métrica': 'Total de Proyectos', 'Valor': projects.length },
        { 'Métrica': 'Total de Instituciones', 'Valor': institutions.size },
        { 'Métrica': 'Total de Categorías', 'Valor': categories.size },
        { 'Métrica': 'Fecha de Exportación', 'Valor': new Date().toLocaleString('es-EC') },
        { 'Métrica': 'Exportado por', 'Valor': 'Sistema FONAG 2025' }
    ];
}

// ====================================
// FUNCIONES DE AUTENTICACIÓN
// ====================================

// Verificar estado de autenticación
auth.onAuthStateChanged((user) => {
    if (user) {
        currentUser = user;
        isAdmin = true;
        updateAuthUI(true);
        document.body.classList.add('admin-mode');
        showToast('Sesión de administrador activa', 'success');
        renderProjects(); // Re-renderizar para mostrar botones de eliminar
    } else {
        currentUser = null;
        isAdmin = false;
        updateAuthUI(false);
        document.body.classList.remove('admin-mode');
        renderProjects(); // Re-renderizar para ocultar botones de eliminar
    }
});

// Mostrar/ocultar modal de autenticación
function toggleAuthModal() {
    const modal = document.getElementById('auth-modal');
    if (currentUser) {
        // Si está logueado, preguntar si quiere cerrar sesión
        if (confirm('¿Deseas cerrar la sesión de administrador?')) {
            logout();
        }
    } else {
        modal.classList.add('show');
    }
}

// Cerrar modal
function closeAuthModal() {
    const modal = document.getElementById('auth-modal');
    modal.classList.remove('show');
    clearAuthForm();
}

// Limpiar formulario
function clearAuthForm() {
    document.getElementById('admin-email').value = '';
    document.getElementById('admin-password').value = '';
    document.getElementById('auth-error').style.display = 'none';
    document.getElementById('auth-success').style.display = 'none';
}

// Manejar login
document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('admin-email').value;
    const password = document.getElementById('admin-password').value;
    const errorDiv = document.getElementById('auth-error');
    const successDiv = document.getElementById('auth-success');
    
    errorDiv.style.display = 'none';
    successDiv.style.display = 'none';
    
    try {
        // Intentar iniciar sesión
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        
        successDiv.textContent = '✓ Sesión iniciada correctamente';
        successDiv.style.display = 'block';
        
        setTimeout(() => {
            closeAuthModal();
        }, 1500);
        
    } catch (error) {
        console.error('Error de autenticación:', error);
        
        // Mostrar mensaje de error según el tipo
        let errorMessage = 'Error al iniciar sesión';
        
        switch(error.code) {
            case 'auth/invalid-email':
                errorMessage = 'Correo electrónico inválido';
                break;
            case 'auth/user-not-found':
                errorMessage = 'Usuario no encontrado';
                break;
            case 'auth/wrong-password':
                errorMessage = 'Contraseña incorrecta';
                break;
            case 'auth/invalid-credential':
                errorMessage = 'Credenciales inválidas';
                break;
            case 'auth/too-many-requests':
                errorMessage = 'Demasiados intentos. Intenta más tarde';
                break;
        }
        
        errorDiv.textContent = errorMessage;
        errorDiv.style.display = 'block';
    }
});

// Cerrar sesión
async function logout() {
    try {
        await auth.signOut();
        showToast('Sesión cerrada', 'success');
        closeAuthModal();
    } catch (error) {
        console.error('Error al cerrar sesión:', error);
        showToast('Error al cerrar sesión', 'error');
    }
}

// Actualizar UI según estado de autenticación
function updateAuthUI(isLoggedIn) {
    const authButton = document.getElementById('auth-button');
    const authButtonText = document.getElementById('auth-button-text');
    const logoutBtn = document.getElementById('logout-btn');
    
    if (isLoggedIn) {
        authButton.classList.add('logged-in');
        authButtonText.textContent = 'Admin: Cerrar Sesión';
        if (logoutBtn) logoutBtn.style.display = 'block';
    } else {
        authButton.classList.remove('logged-in');
        authButtonText.textContent = 'Administrador';
        if (logoutBtn) logoutBtn.style.display = 'none';
    }
}
// ====================================
// INICIALIZACIÓN
// ====================================

document.addEventListener('DOMContentLoaded', async () => {
    // Inicializar mapa
    initializeMap();
    
    // Configurar formulario
    document.getElementById('project-form').addEventListener('submit', addProject);
    
    // Configurar búsqueda
    document.getElementById('search-box').addEventListener('input', (e) => {
        searchTerm = e.target.value.toLowerCase();
        renderProjects();
    });
    
    // Cargar proyectos
    await loadProjects();
    
    // Escuchar cambios en tiempo real
    listenToProjects();
    
    // Ocultar loading
    hideLoading();
    
    // Verificar conexión periódicamente
    setInterval(() => {
        db.collection('_ping').doc('test').set({
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        }).then(() => {
            if (!isOnline) updateConnectionStatus('online');
        }).catch(() => {
            if (isOnline) updateConnectionStatus('offline');
        });
    }, 30000);
});

// Hacer funciones globales para los botones
window.deleteProject = deleteProject;
window.exportToExcel = exportToExcel;
window.toggleAuthModal = toggleAuthModal;
window.closeAuthModal = closeAuthModal;
window.logout = logout;
window.resetMap = resetMap;
window.zoomIn = zoomIn;
window.zoomOut = zoomOut;
window.fitAllProjects = fitAllProjects;
window.clearLocationSelection = clearLocationSelection;

