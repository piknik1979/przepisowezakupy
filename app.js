const { createClient } = supabase;
const _supabase = createClient(CONFIG.SB_URL, CONFIG.SB_KEY);

let currentEditingRecipeId = null;
let isSignUpMode = false;

// --- 1. SYSTEM AUTORYZACJI ---
async function checkUser() {
    try {
        const { data: { user }, error } = await _supabase.auth.getUser();
        if (error) throw error;
        const authOverlay = document.getElementById('auth-container');
        const appContent = document.getElementById('app-content');

        if (user) {
            authOverlay.style.display = 'none';
            appContent.style.display = 'block';
            document.getElementById('user-email-display').innerText = `Użytkownik: ${user.email}`;
            refreshData();
        } else {
            authOverlay.style.display = 'flex';
            appContent.style.display = 'none';
        }
    } catch (err) {
        if (document.getElementById('auth-container')) {
            document.getElementById('auth-container').style.display = 'flex';
        }
    }
}

window.handleAuthSubmit = async (event) => {
    event.preventDefault();
    const btn = document.getElementById('btn-auth-submit');
    const email = document.getElementById('auth-email').value;
    const pass = document.getElementById('auth-password').value;
    btn.disabled = true;
    btn.innerText = "Przetwarzanie...";

    try {
        if (isSignUpMode) {
            const retype = document.getElementById('auth-retype').value;
            if (pass !== retype) throw new Error("Hasła nie są identyczne!");
            const { error } = await _supabase.auth.signUp({ email, password: pass });
            if (error) throw error;
            alert("Konto utworzone! Zaloguj się.");
            toggleAuthMode(false);
        } else {
            const { error } = await _supabase.auth.signInWithPassword({ email, password: pass });
            if (error) throw error;
            await checkUser();
        }
    } catch (err) {
        alert("Błąd: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = isSignUpMode ? 'Zarejestruj mnie' : 'Zaloguj się';
    }
};

window.toggleAuthMode = (isSignUp) => {
    isSignUpMode = isSignUp;
    document.getElementById('auth-title').innerText = isSignUp ? 'Rejestracja' : 'Logowanie';
    document.getElementById('retype-wrapper').style.display = isSignUp ? 'block' : 'none';
    document.getElementById('btn-auth-submit').innerText = isSignUp ? 'Zarejestruj mnie' : 'Zaloguj się';
    document.getElementById('switch-area').innerHTML = isSignUp 
        ? `Masz już konto? <a href="#" onclick="toggleAuthMode(false)">Zaloguj się</a>`
        : `Nie masz konta? <a href="#" onclick="toggleAuthMode(true)">Zarejestruj się</a>`;
};

window.handleSignOut = async () => { await _supabase.auth.signOut(); location.reload(); };

window.togglePasswordVisibility = (id) => {
    const el = document.getElementById(id);
    if (el) el.type = el.type === 'password' ? 'text' : 'password';
};

// --- 2. LISTA ZAKUPÓW ---
async function refreshData() {
    const { data: shopping } = await _supabase.from('shopping_list').select('*, products(name)').order('is_bought', { ascending: true });
    const { data: recipes } = await _supabase.from('recipes').select('*').order('title');
    renderShoppingList(shopping || []);
    renderRecipesMenu(recipes || []);
    updateAutocompletes();
}

function renderShoppingList(list) {
    document.getElementById('shopping-list').innerHTML = list.map(item => `
        <li class="shopping-item">
            <span onclick="toggleItem('${item.id}', ${item.is_bought})" class="item-text ${item.is_bought ? 'bought' : ''}">
                ${item.is_bought ? '✅' : '⬜'} <strong>${item.products?.name || 'Produkt'}</strong> ${item.amount || ''} ${item.unit || ''}
            </span>
            <button onclick="removeItem('${item.id}')" class="del-btn">&times;</button>
        </li>
    `).join('');
}

window.addItemManually = async () => {
    const name = document.getElementById('new-item-name').value;
    const amountVal = document.getElementById('new-item-amount').value;
    if (!name) return;
    const productId = await getOrCreateProductId(name);
    const { data: { user } } = await _supabase.auth.getUser();
    
    await _supabase.from('shopping_list').insert([{ 
        product_id: productId, 
        amount: String(amountVal), 
        unit: document.getElementById('new-item-unit').value, 
        user_id: user.id 
    }]);
    
    document.getElementById('new-item-name').value = "";
    document.getElementById('new-item-amount').value = "";
    refreshData();
};

async function getOrCreateProductId(name) {
    let { data: p } = await _supabase.from('products').select('id').ilike('name', name).maybeSingle();
    if (!p) {
        const { data: np } = await _supabase.from('products').insert([{ name }]).select().single();
        return np.id;
    }
    return p.id;
}

// --- 3. PRZEPISY ---
function renderRecipesMenu(list) {
    document.getElementById('recipes-menu').innerHTML = list.map(r => `
        <div class="recipe-item-row" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; background:white; padding:10px; border-radius:12px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
            <button class="recipe-select-btn" style="flex:1; text-align:left; border:none; background:none; font-weight:bold; cursor:pointer;" onclick="displayRecipeCard('${r.id}')">📖 ${r.title}</button>
            <button class="recipe-del-btn" style="border:none; background:none; cursor:pointer; font-size:18px;" onclick="deleteFullRecipe('${r.id}')">🗑️</button>
        </div>
    `).join('');
}

window.displayRecipeCard = async (id) => {
    const { data: r } = await _supabase.from('recipes').select('*').eq('id', id).single();
    const { data: ings } = await _supabase.from('recipe_ingredients').select('*, products(name)').eq('recipe_id', id);
    
    const card = document.getElementById('active-recipe-card');
    document.getElementById('recipes-menu').style.display = 'none';
    card.style.display = 'block';

    card.innerHTML = `
        <div class="recipe-card-modern">
            <div class="card-nav">
                <button onclick="closeRecipeCard()" class="btn-back">← Powrót</button>
                <button onclick="openRecipeEditor('${r.id}')" class="btn-edit-icon">✏️ Edytuj</button>
            </div>
            
            <h2 class="card-title">${r.title}</h2>

            <div class="recipe-info-strip" style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; font-size: 0.85em; color: #444; background: #f4f4f4; padding: 10px; border-radius: 8px; border-left: 4px solid #4CAF50;">
                ${r.prep_time ? `<span>⏱️ <b>Przyg:</b> ${r.prep_time}</span>` : ''}
                ${r.bake_time ? `<span>🔥 <b>Piecz:</b> ${r.bake_time}</span>` : ''}
                ${r.servings ? `<span>👥 <b>Porcje:</b> ${r.servings}</span>` : ''}
                ${r.kcal ? `<span>⚖️ <b>kcal:</b> ${r.kcal}</span>` : ''}
            </div>

            <div class="card-section" style="margin-bottom: 20px;">
                <div class="section-header">
                    <h3 style="margin-bottom: 10px;">Składniki</h3>
                </div>
                <div id="ings-content" class="section-content">
                    <ul class="modern-ing-list" style="list-style:none; padding:0;">
                        ${ings.map(i => `
                            <li style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #eee;">
                                <div>
                                    <input type="checkbox" class="ing-to-buy" data-pid="${i.product_id}" data-amt="${i.amount || ''}" data-unt="${i.unit || ''}" checked>
                                    <span>${i.products?.name} <strong>${i.amount || ''} ${i.unit || ''}</strong></span>
                                </div>
                                <button onclick="deleteIngFromRecipeGlobal('${i.id}', '${id}')" style="background:none; border:none; color:#ff4444; cursor:pointer; font-size:20px; font-weight:bold;">&times;</button>
                            </li>`).join('')}
                    </ul>
                    <button onclick="addSelectedToCart()" class="btn-add-to-cart" style="margin-top: 15px; width: 100%;">Dodaj wybrane do listy 🛒</button>
                </div>
            </div>

            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">

            <div class="card-section">
                <div class="section-header" onclick="toggleCardSection('desc-content')" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
                    <h3>Sposób przygotowania</h3>
                    <span id="desc-content-arrow">▼</span>
                </div>
                <div id="desc-content" class="section-content" style="display:block; padding:15px; background:#fdfdfd; border: 1px solid #eee; border-radius:10px; white-space: pre-wrap; line-height: 1.5;">
                    ${r.instructions || 'Brak opisu.'}
                </div>
            </div>
        </div>
    `;
};

window.deleteIngFromRecipeGlobal = async (ingId, recipeId) => {
    if(confirm("Usunąć ten składnik z przepisu?")) {
        await _supabase.from('recipe_ingredients').delete().eq('id', ingId);
        displayRecipeCard(recipeId);
    }
};

window.openRecipeEditor = async (id = null) => {
    currentEditingRecipeId = id;
    const fields = {
        'edit-recipe-name': 'title',
        'edit-recipe-prep': 'prep_time',
        'edit-recipe-bake': 'bake_time',
        'edit-recipe-servings': 'servings',
        'edit-recipe-kcal': 'kcal',
        'edit-recipe-instructions': 'instructions',
        'edit-recipe-url': 'url'
    };

    if (id) {
        document.getElementById('editor-header-title').innerText = "Edytuj przepis";
        const { data: r } = await _supabase.from('recipes').select('*').eq('id', id).single();
        Object.keys(fields).forEach(f => {
            const el = document.getElementById(f);
            if (el) el.value = r[fields[f]] || "";
        });
        loadEditorIngredients(id);
    } else {
        document.getElementById('editor-header-title').innerText = "Nowy przepis";
        Object.keys(fields).forEach(f => {
            const el = document.getElementById(f);
            if (el) el.value = "";
        });
        document.getElementById('editor-ingredients-list').innerHTML = "";
    }
    showView('editor');
};

async function loadEditorIngredients(rid) {
    const { data: ings } = await _supabase.from('recipe_ingredients').select('*, products(name)').eq('recipe_id', rid);
    document.getElementById('editor-ingredients-list').innerHTML = (ings || []).map(i => `
        <li style="display:flex; justify-content:space-between; align-items:center; padding: 10px 0; border-bottom: 1px solid #eee;">
            <span><strong>${i.products?.name}</strong> (${i.amount || ''} ${i.unit || ''})</span>
            <button onclick="deleteIngFromRecipe('${i.id}')" style="background:none; border:none; color:red; cursor:pointer; font-size:24px;">&times;</button>
        </li>`).join('');
}

window.saveRecipeData = async () => {
    const { data: { user } } = await _supabase.auth.getUser();
    const d = {
        title: document.getElementById('edit-recipe-name').value || "Bez nazwy",
        prep_time: document.getElementById('edit-recipe-prep').value,
        bake_time: document.getElementById('edit-recipe-bake').value,
        servings: document.getElementById('edit-recipe-servings').value,
        kcal: document.getElementById('edit-recipe-kcal').value,
        instructions: document.getElementById('edit-recipe-instructions').value,
        url: document.getElementById('edit-recipe-url').value,
        user_id: user.id
    };
    if (currentEditingRecipeId) {
        await _supabase.from('recipes').update(d).eq('id', currentEditingRecipeId);
    } else {
        const { data } = await _supabase.from('recipes').insert([d]).select().single();
        if (data) currentEditingRecipeId = data.id;
    }
    alert("Zapisano dane przepisu!");
    refreshData();
};

window.addIngredientToRecipe = async () => {
    const name = document.getElementById('ing-name').value;
    const amountVal = document.getElementById('ing-amount').value;
    const unit = document.getElementById('ing-unit').value;
    
    if (!name) return;

    if (!currentEditingRecipeId) {
        alert("Zapisz najpierw nazwę przepisu!");
        return;
    }

    const productId = await getOrCreateProductId(name);
    await _supabase.from('recipe_ingredients').insert([{ 
        recipe_id: currentEditingRecipeId, 
        product_id: productId, 
        amount: String(amountVal), 
        unit: unit 
    }]);

    document.getElementById('ing-name').value = "";
    document.getElementById('ing-amount').value = "";
    loadEditorIngredients(currentEditingRecipeId);
};

window.addSelectedToCart = async () => {
    const { data: { user } } = await _supabase.auth.getUser();
    const sel = document.querySelectorAll('.ing-to-buy:checked');
    const items = Array.from(sel).map(cb => ({ 
        product_id: cb.dataset.pid, 
        amount: String(cb.dataset.amt), 
        unit: cb.dataset.unt, 
        user_id: user.id 
    }));
    if(items.length > 0) { 
        await _supabase.from('shopping_list').upsert(items, { onConflict: 'user_id, product_id' }); 
        alert("Dodano do listy!"); 
        refreshData(); 
        closeRecipeCard(); 
    }
};

window.updateAutocompletes = async () => {
    const { data: products } = await _supabase.from('products').select('name').limit(20);
    const dl = document.getElementById('products-datalist');
    if (dl) dl.innerHTML = (products || []).map(p => `<option value="${p.name}">`).join('');
    
    const units = ['g', 'kg', 'ml', 'l', 'szt', 'opak.', 'łyżka', 'łyżeczka', 'szklanka'];
    const ul = document.getElementById('units-datalist');
    if (ul) ul.innerHTML = units.map(u => `<option value="${u}">`).join('');
};

window.showView = (v) => {
    document.getElementById('view-main').style.display = v === 'main' ? 'block' : 'none';
    document.getElementById('view-editor').style.display = v === 'editor' ? 'block' : 'none';
};

window.closeRecipeCard = () => { 
    document.getElementById('active-recipe-card').style.display = 'none'; 
    document.getElementById('recipes-menu').style.display = 'block'; 
};

window.deleteFullRecipe = async (id) => { 
    if(confirm("Usunąć trwale ten przepis?")) { 
        await _supabase.from('recipes').delete().eq('id', id); 
        refreshData(); 
    } 
};

window.deleteIngFromRecipe = async (id) => { 
    await _supabase.from('recipe_ingredients').delete().eq('id', id); 
    loadEditorIngredients(currentEditingRecipeId); 
};

window.toggleItem = async (id, s) => { 
    await _supabase.from('shopping_list').update({ is_bought: !s }).eq('id', id); 
    refreshData(); 
};

window.removeItem = async (id) => { 
    await _supabase.from('shopping_list').delete().eq('id', id); 
    refreshData(); 
};

window.clearBought = async () => { 
    const { data: { user } } = await _supabase.auth.getUser();
    await _supabase.from('shopping_list').delete().eq('user_id', user.id).eq('is_bought', true); 
    refreshData(); 
};

window.clearAllShopping = async () => { 
    if(confirm("Wyczyścić całą listę?")) { 
        const { data: { user } } = await _supabase.auth.getUser();
        await _supabase.from('shopping_list').delete().eq('user_id', user.id); 
        refreshData(); 
    } 
};

window.toggleCardSection = (id) => {
    const el = document.getElementById(id);
    const arrow = document.getElementById(id + '-arrow');
    if (el) {
        if (el.style.display === 'none') {
            el.style.display = 'block';
            if (arrow) arrow.innerText = '▼';
        } else {
            el.style.display = 'none';
            if (arrow) arrow.innerText = '▶';
        }
    }
};

checkUser();