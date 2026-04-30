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

window.togglePasswordVisibility = (id) => {
    const el = document.getElementById(id);
    if (el) el.type = el.type === 'password' ? 'text' : 'password';
};

window.handleSignOut = async () => { await _supabase.auth.signOut(); location.reload(); };

// --- 2. LISTA ZAKUPÓW ---
async function refreshData() {
    const { data: shopping } = await _supabase.from('shopping_list').select('*, products(name)').order('is_bought', { ascending: true });
    const { data: recipes } = await _supabase.from('recipes').select('*').order('title');
    renderShoppingList(shopping || []);
    renderRecipesMenu(recipes || []);
    updateAutocompletes();
}

function renderShoppingList(list) {
    const listElement = document.getElementById('shopping-list');
    if (!listElement) return;
    listElement.innerHTML = list.map(item => `
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
        const { data: np, error } = await _supabase.from('products').insert([{ name }]).select().single();
        if (error) return null;
        return np.id;
    }
    return p.id;
}

window.clearBought = async function() {
    if (!confirm("Usunąć zaznaczone jako kupione?")) return;
    try {
        const { data: { user } } = await _supabase.auth.getUser();
        await _supabase.from('shopping_list').delete().eq('user_id', user.id).eq('is_bought', true);
        refreshData();
    } catch (err) {
        alert("Błąd: " + err.message);
    }
};

window.clearAllShopping = async function() {
    if (!confirm("Czy na pewno wyczyścić CAŁĄ listę zakupów?")) return;
    try {
        const { data: { user } } = await _supabase.auth.getUser();
        await _supabase.from('shopping_list').delete().eq('user_id', user.id);
        refreshData();
    } catch (err) {
        alert("Błąd: " + err.message);
    }
};

// --- 3. PRZEPISY ---
function renderRecipesMenu(list) {
    const menuElement = document.getElementById('recipes-menu');
    if (!menuElement) return;
    menuElement.innerHTML = list.map(r => `
        <div class="recipe-item-row" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; background:#fff; padding:10px; border-radius:8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
            <button style="flex:1; text-align:left; border:none; background:none; font-weight:bold; cursor:pointer;" onclick="displayRecipeCard('${r.id}')">📖 ${r.title}</button>
            <button style="border:none; background:none; cursor:pointer;" onclick="deleteFullRecipe('${r.id}')">🗑️</button>
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
            <button onclick="closeRecipeCard()" class="back-btn">← Powrót</button>
            <button onclick="openRecipeEditor('${r.id}')" class="edit-btn">✏️ Edytuj</button>
            <h2 style="margin: 15px 0 10px 0;">${r.title}</h2>
            <div style="font-size:0.85em; color:#666; margin-bottom:15px; background:#f9f9f9; padding:8px; border-radius:6px;">
                ⏱️ Przyg: ${r.prep_time || '-'} | 👥 Porcje: ${r.servings || '-'} | 🔥 ${r.kcal || '-'} kcal
            </div>
            <h3>Składniki:</h3>
            <ul style="list-style:none; padding:0;">
                ${ings.map(i => `<li style="padding: 5px 0; border-bottom: 1px solid #eee;">
                    <input type="checkbox" class="ing-to-buy" data-pid="${i.product_id}" data-amt="${i.amount || ''}" data-unt="${i.unit || ''}" checked>
                    ${i.products?.name} <strong>${i.amount || ''} ${i.unit || ''}</strong>
                </li>`).join('')}
            </ul>
            <button onclick="addSelectedToCart()" class="save-btn" style="width:100%; margin-top:15px;">Dodaj wybrane do listy 🛒</button>
            <h3 style="margin-top:20px;">Sposób przygotowania:</h3>
            <div style="white-space: pre-wrap; line-height:1.5;">${r.instructions || 'Brak opisu.'}</div>
        </div>
    `;
};

window.openRecipeEditor = async (id = null) => {
    currentEditingRecipeId = id;
    const fields = ['edit-recipe-name', 'edit-recipe-prep', 'edit-recipe-bake', 'edit-recipe-servings', 'edit-recipe-kcal', 'edit-recipe-instructions'];
    fields.forEach(f => {
        const el = document.getElementById(f);
        if (el) el.value = "";
    });
    
    const urlField = document.getElementById('edit-recipe-url');
    if (urlField) urlField.value = "";

    document.getElementById('editor-ingredients-list').innerHTML = "";

    if (id) {
        document.getElementById('editor-header-title').innerText = "Edytuj przepis";
        const { data: r } = await _supabase.from('recipes').select('*').eq('id', id).single();
        document.getElementById('edit-recipe-name').value = r.title || "";
        document.getElementById('edit-recipe-prep').value = r.prep_time || "";
        document.getElementById('edit-recipe-bake').value = r.bake_time || "";
        document.getElementById('edit-recipe-servings').value = r.servings || "";
        document.getElementById('edit-recipe-kcal').value = r.kcal || "";
        document.getElementById('edit-recipe-instructions').value = r.instructions || "";
        loadEditorIngredients(id);
    } else {
        document.getElementById('editor-header-title').innerText = "Nowy przepis";
    }
    showView('editor');
};

async function loadEditorIngredients(rid) {
    const { data: ings } = await _supabase.from('recipe_ingredients').select('*, products(name)').eq('recipe_id', rid);
    document.getElementById('editor-ingredients-list').innerHTML = (ings || []).map(i => `
        <li style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #eee;">
            <span>${i.products?.name} (${i.amount} ${i.unit})</span>
            <button onclick="deleteIngFromRecipe('${i.id}')" style="color:red; border:none; background:none; cursor:pointer; font-size:1.2em;">&times;</button>
        </li>`).join('');
}

window.saveRecipeData = async () => {
    try {
        const { data: { user } } = await _supabase.auth.getUser();
        
        // Ważne: usuwamy pole 'url', jeśli powoduje błąd 400 (brak kolumny w bazie)
        const d = {
            title: document.getElementById('edit-recipe-name').value || "Bez nazwy",
            prep_time: document.getElementById('edit-recipe-prep').value,
            bake_time: document.getElementById('edit-recipe-bake').value,
            servings: document.getElementById('edit-recipe-servings').value,
            kcal: document.getElementById('edit-recipe-kcal').value,
            instructions: document.getElementById('edit-recipe-instructions').value,
            user_id: user.id
        };

        if (currentEditingRecipeId) {
            const { error } = await _supabase.from('recipes').update(d).eq('id', currentEditingRecipeId);
            if (error) throw error;
        } else {
            const { data, error } = await _supabase.from('recipes').insert([d]).select().single();
            if (error) throw error;
            if (data) currentEditingRecipeId = data.id;
        }
        alert("Zapisano dane przepisu!");
        refreshData();
    } catch (err) {
        console.error("Błąd zapisu:", err);
        alert("Błąd zapisu (400): Upewnij się, że nie przesyłasz pól, których nie ma w bazie danych.");
    }
};

window.addIngredientToRecipe = async () => {
    const name = document.getElementById('ing-name').value;
    const amount = document.getElementById('ing-amount').value;
    const unit = document.getElementById('ing-unit').value;
    
    if (!name) return;
    if (!currentEditingRecipeId) {
        alert("Najpierw kliknij 'Zapisz' pod instrukcjami, aby utworzyć przepis.");
        return;
    }

    const productId = await getOrCreateProductId(name);
    const { error } = await _supabase.from('recipe_ingredients').insert([{ 
        recipe_id: currentEditingRecipeId, 
        product_id: productId, 
        amount, 
        unit 
    }]);

    if (error) alert(error.message);
    else {
        document.getElementById('ing-name').value = "";
        document.getElementById('ing-amount').value = "";
        loadEditorIngredients(currentEditingRecipeId);
    }
};

window.addSelectedToCart = async () => {
    const { data: { user } } = await _supabase.auth.getUser();
    const sel = document.querySelectorAll('.ing-to-buy:checked');
    const items = Array.from(sel).map(cb => ({ 
        product_id: cb.dataset.pid, 
        amount: cb.dataset.amt, 
        unit: cb.dataset.unt, 
        user_id: user.id 
    }));
    
    if (items.length > 0) {
        await _supabase.from('shopping_list').insert(items);
        alert("Dodano do listy zakupów!");
        refreshData();
        closeRecipeCard();
    }
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
    if (confirm("Usunąć ten przepis?")) {
        await _supabase.from('recipes').delete().eq('id', id);
        refreshData();
    }
};

window.deleteIngFromRecipe = async (id) => { 
    await _supabase.from('recipe_ingredients').delete().eq('id', id); 
    if (currentEditingRecipeId) loadEditorIngredients(currentEditingRecipeId);
};

window.toggleItem = async (id, s) => { 
    await _supabase.from('shopping_list').update({ is_bought: !s }).eq('id', id); 
    refreshData(); 
};

window.removeItem = async (id) => { 
    await _supabase.from('shopping_list').delete().eq('id', id); 
    refreshData(); 
};

window.updateAutocompletes = async () => {
    const { data: products } = await _supabase.from('products').select('name').limit(50);
    const dl = document.getElementById('products-datalist');
    if (dl) dl.innerHTML = (products || []).map(p => `<option value="${p.name}">`).join('');
};

checkUser();