import { Show, createSignal, createEffect } from "solid-js";
import { Icon } from '@iconify-icon/solid';
import gsap from "gsap";

const Hamburger = () => {
    const [open, setOpen] = createSignal(false);
    let menuRef: HTMLDivElement | undefined;
    
    const handleToggle = () => {
        if (!open()) {
            setOpen(true);
        } else {
            if (menuRef) {
                gsap.to(menuRef, {
                    opacity: 0,
                    scale: 0.95,
                    duration: 0.2,
                    ease: "power2.in",
                    onComplete: () => {
                        setOpen(false);
                    }
                });
            }
        }
    };
    
    createEffect(() => {
        if (open() && menuRef) {
            gsap.fromTo(menuRef, 
                { opacity: 0, scale: 0.95 },
                { opacity: 1, scale: 1, duration: 0.2, ease: "power2.out" }
            );
        }
    });
    
    return (
        <>
            <button
                class="md:hidden justify-self-center z-60 relative"
                onClick={handleToggle}
                aria-label="Menu"
            >
                <Icon 
                    icon={open() ? "fa:close" : "garden:menu-fill-12"} 
                    height={45}
                    class="transition-transform duration-200"
                />
            </button>
            <Show when={open()}>
                <div
                    ref={menuRef}
                    class="fixed inset-0 bg-white flex flex-col justify-between p-8 z-50 pt-20"
                >
                    <div class="flex flex-col gap-6 text-3xl font-semibold">
                        <a href="#about" onClick={handleToggle} class="hover:text-black/60">
                            About
                        </a>
                        <a href="#projects" onClick={handleToggle} class="hover:text-black/60">
                            Projects
                        </a>
                        <a href="#contact" onClick={handleToggle} class="hover:text-black/60">
                            Contact
                        </a>
                    </div>
                    <div class="flex justify-center gap-10 pb-4">
                        <a href="https://github.com/externalhost0" target="_blank" rel="noopener noreferrer">
                            <Icon icon="mdi:github" height={55} class="hover:text-black/60 transition-colors" />
                        </a>
                        <a href="https://linkedin.com/in/hayden-rivas" target="_blank" rel="noopener noreferrer">
                            <Icon icon="mdi:linkedin" height={55} class="hover:text-black/60 transition-colors" />
                        </a>
                    </div>
                </div>
            </Show>
        </>
    );
};

export default Hamburger;