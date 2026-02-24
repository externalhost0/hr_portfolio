import { type Component, onMount } from "solid-js";
import gsap from "gsap";

const Section = ({ title, startsChecked = false }: { title: string, startsChecked?: boolean }) => {
    return (
        <label class="cursor-pointer">
            <input type="radio" name="section" class="peer sr-only" checked={startsChecked}/>
            <span class="px-8 py-1.5 rounded-xl transition-colors
            hover:bg-white/15 hover:text-black
             peer-checked:bg-neutral-900/95 peer-checked:text-white
             peer-checked:hover:bg-neutral-900/80 peer-checked:hover:text-white">
                {title}
            </span>
        </label>
    );
};

const NavbarSections = () => {
    return (
        <div class="relative bg-brand justify-self-center flex flex-row justify-evenly items-center border gap-1 px-1 rounded-2xl py-1.5">
            <Section title="About" startsChecked={true}/>
            <Section title="Projects"/>
            <Section title="Contact"/>
        </div>
    );
};

export default NavbarSections;
