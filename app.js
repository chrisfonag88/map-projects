// ====================================
// CONFIGURACIÓN DE FIREBASE
// ====================================

// Obtener referencia a Firestore
const db = firebase.firestore();

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

// Colores para categorías
const categoryColors = {
    'Educación': '#4CAF50',
    'Salud': '#F44336',
    'Medio Ambiente': '#8BC34A',
    'Infraestructura': '#FF9800',
    'Desarrollo Social': '#2196F3',
    'Tecnología': '#9C27B0',
    'Cultura': '#795548',
    'Agricultura': '#CDDC39',
    'Otro': '#607D8B'
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
    map = L.map('map').setView([-1.8312, -78.1834], 7);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    
    // Evento de clic en el mapa
    map.on('click', function(e) {
        if (tempMarker) {
            map.removeLayer(tempMarker);
        }
        
        tempLocation = e.latlng;
        tempMarker = L.marker(tempLocation, { 
            icon: createColoredIcon('#FF5722', true) 
        }).addTo(map);
        
        updateLocationStatus(true);
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
        <div style="min-width: 200px;">
            <h3 style="margin: 0 0 10px 0; color: ${color};">${project.name}</h3>
            <p style="margin: 5px 0; font-size: 0.9em;">
                <strong>Institución:</strong> ${project.institution}
            </p>
            <p style="margin: 5px 0; font-size: 0.9em;">
                <strong>Categoría:</strong> ${project.category}
            </p>
            <p style="margin: 10px 0; font-size: 0.9em;">
                ${project.description}
            </p>
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
        const color = categoryColors[project.category] || categoryColors['Otro'];
        return `
            <div class="project-item" data-id="${project.id}">
                <div class="project-header">
                    <span class="project-title">${project.name}</span>
                    <button class="delete-btn" onclick="deleteProject('${project.id}')">
                        <i class="fas fa-trash"></i> Eliminar
                    </button>
                </div>
                <div class="project-institution">
                    <i class="fas fa-building"></i> ${project.institution}
                </div>
                <div class="project-description">${project.description}</div>
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
        name: document.getElementById('project-name').value.trim(),
        category: document.getElementById('category').value,
        description: document.getElementById('description').value.trim(),
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

function exportData() {
    if (projects.length === 0) {
        showToast('No hay proyectos para exportar', 'warning');
        return;
    }
    
    // Preparar datos para exportación
    const exportData = projects.map(p => ({
        ...p,
        createdAt: p.createdAt ? formatDate(p.createdAt) : 'N/A'
    }));
    
    const dataStr = JSON.stringify(exportData, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `proyectos_ecuador_${new Date().toISOString().split('T')[0]}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    
    showToast('Datos exportados exitosamente', 'success');
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
window.exportData = exportData;